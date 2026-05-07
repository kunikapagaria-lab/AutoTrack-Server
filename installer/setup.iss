#define MyAppName    "AutoTrack"
#define MyAppVersion "1.0"
#define BuildDate    GetDateTimeString('yyyy-mm-dd', '', '')

[Setup]
AppId={{8F3A2D1B-4C5E-6F7A-8B9C-0D1E2F3A4B5C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=AutoTrack
DefaultDirName=C:\AutoTrack
DisableProgramGroupPage=yes
DisableDirPage=yes
OutputDir=output
OutputBaseFilename=AutoTrack-Setup-{#BuildDate}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
MinVersion=10.0
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Desktop launcher — opens the app in a native window (no browser)
Source: "AutoTrack.exe"; DestDir: "{app}"; Flags: ignoreversion

; Docker Compose config — uses pre-built images from Docker Hub
Source: "docker-compose.branch.yml"; DestDir: "{app}"; DestName: "docker-compose.yml"; Flags: ignoreversion

; Env generator script — deleted automatically after use
Source: "write_env.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
; Desktop shortcut — double-click to open AutoTrack
Name: "{commondesktop}\AutoTrack"; Filename: "{app}\AutoTrack.exe"; Comment: "Open AutoTrack Workshop Manager"

[Code]

// Three wizard input pages
var
  BranchPage: TInputQueryWizardPage;   // Branch name
  RTSPPage:   TInputQueryWizardPage;   // Camera URL
  APIKeyPage: TInputQueryWizardPage;   // Cloud API key

// ── Check Docker Desktop is installed ─────────────────────────────────────────
// Docker Desktop must be installed BEFORE running this installer.
// We check by running "docker --version" and seeing if it succeeds.
function DockerInstalled: Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c docker --version >nul 2>&1', '',
                 SW_HIDE, ewWaitUntilTerminated, ResultCode)
            and (ResultCode = 0);
end;

// ── Create the three wizard pages ─────────────────────────────────────────────
procedure InitializeWizard;
begin
  // Page 1: Branch Name
  // This is the name that appears in the superadmin cloud dashboard.
  BranchPage := CreateInputQueryPage(
    wpWelcome,
    'Branch Name',
    'What is the name of this branch location?',
    'This name will appear in the admin dashboard to identify this branch.' + #13#10 +
    'Example: North Branch, Koramangala Workshop, HSR Layout'
  );
  BranchPage.Add('Branch Name:', False);
  BranchPage.Values[0] := 'Main Branch';

  // Page 2: RTSP Camera URL
  // The IP camera address. Optional — can be set later from inside the app.
  RTSPPage := CreateInputQueryPage(
    BranchPage.ID,
    'Camera Setup',
    'Enter your IP camera RTSP URL',
    'This is the address of the RTSP camera at this branch.' + #13#10 +
    'You can leave this blank and set it later from the app Settings menu.'
  );
  RTSPPage.Add('RTSP URL (leave blank to skip):', False);
  RTSPPage.Values[0] := '';

  // Page 3: Branch API Key
  // The superadmin generates this from the cloud dashboard before installation.
  // It links this branch to the cloud server automatically.
  APIKeyPage := CreateInputQueryPage(
    RTSPPage.ID,
    'Cloud Connection',
    'Enter the Branch API Key',
    'The super admin generates this key from the cloud dashboard.' + #13#10 +
    'It connects this branch to the cloud server automatically.' + #13#10 + #13#10 +
    'If you don''t have it yet, leave blank — you can connect later from the app.'
  );
  APIKeyPage.Add('Branch API Key (leave blank to skip):', False);
  APIKeyPage.Values[0] := '';
end;

// ── Block install if Docker is not installed ───────────────────────────────────
// We show a clear message explaining exactly what to do.
function InitializeSetup: Boolean;
begin
  Result := True;
  if not DockerInstalled then begin
    MsgBox(
      'Docker Desktop is not installed.' + #13#10 + #13#10 +
      'AutoTrack requires Docker Desktop to run.' + #13#10 + #13#10 +
      'Please do this first:' + #13#10 +
      '  1. Go to https://www.docker.com/products/docker-desktop' + #13#10 +
      '  2. Download and install Docker Desktop' + #13#10 +
      '  3. Restart this PC when asked' + #13#10 +
      '  4. Open Docker Desktop from the Start menu' + #13#10 +
      '  5. Wait for the whale icon in the taskbar to stop animating' + #13#10 +
      '  6. Run this installer again',
      mbError, MB_OK
    );
    Result := False;
  end;
end;

// ── Validate required fields ───────────────────────────────────────────────────
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  // Branch name is required — we can't install without knowing what to call this branch
  if CurPageID = BranchPage.ID then begin
    if Trim(BranchPage.Values[0]) = '' then begin
      MsgBox('Please enter a branch name before continuing.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// ── Post-install: write config files and download Docker images ────────────────
// This runs after all files have been copied to C:\AutoTrack
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PSArgs:     String;
begin
  if CurStep = ssPostInstall then begin

    // Write the RTSP URL and API Key to temp files.
    // We use temp files instead of command-line arguments because
    // special characters in camera URLs (like @ : /) break command-line parsing.
    SaveStringToFile(
      ExpandConstant('{tmp}\autotrack_rtsp.txt'),
      RTSPPage.Values[0],
      False
    );
    SaveStringToFile(
      ExpandConstant('{tmp}\autotrack_apikey.txt'),
      APIKeyPage.Values[0],
      False
    );

    // Run write_env.ps1 which:
    //   - Reads the temp files we just wrote
    //   - Generates a random JWT security key
    //   - Writes backend\.env with all credentials
    //   - Writes backend\data\initial_config.json for auto cloud connection
    PSArgs := '-ExecutionPolicy Bypass -NonInteractive -File "' +
              ExpandConstant('{tmp}\write_env.ps1') + '"' +
              ' -InstallDir "' + ExpandConstant('{app}') + '"' +
              ' -BranchName "' + BranchPage.Values[0] + '"';

    Exec('powershell.exe', PSArgs, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    // Download Docker images from Docker Hub.
    // This opens a visible terminal window so the user can see the progress.
    // The images are about 3-4 GB so this takes 5-15 minutes depending on internet.
    Exec(
      'cmd.exe',
      '/k "echo. && ' +
          'echo  ================================================ && ' +
          'echo  Downloading AutoTrack components from internet... && ' +
          'echo  This takes 5-15 minutes depending on your speed. && ' +
          'echo  Please wait - do NOT close this window. && ' +
          'echo  ================================================ && ' +
          'echo. && ' +
          'cd /d "' + ExpandConstant('{app}') + '" && ' +
          'docker compose pull && ' +
          'echo. && ' +
          'echo  Download complete! && ' +
          'echo  Click the AutoTrack icon on your desktop to start. && ' +
          'timeout /t 5 && ' +
          'exit"',
      ExpandConstant('{app}'),
      SW_SHOW,
      ewWaitUntilTerminated,
      ResultCode
    );
  end;
end;

// ── Summary page shown before install begins ───────────────────────────────────
// This lets the user review their inputs before clicking Install.
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  RTSPDisplay:   String;
  APIKeyDisplay: String;
begin
  if RTSPPage.Values[0] = '' then
    RTSPDisplay := '(set later in app Settings)'
  else
    RTSPDisplay := RTSPPage.Values[0];

  if APIKeyPage.Values[0] = '' then
    APIKeyDisplay := '(connect manually in app after install)'
  else
    APIKeyDisplay := Copy(APIKeyPage.Values[0], 1, 8) + '...';  // show only first 8 chars for security

  Result :=
    'Branch Name:   ' + BranchPage.Values[0] + NewLine +
    'Camera URL:    ' + RTSPDisplay + NewLine +
    'Cloud API Key: ' + APIKeyDisplay + NewLine +
    NewLine +
    'Install folder: C:\AutoTrack' + NewLine +
    NewLine +
    'What will happen:' + NewLine +
    Space + '1. Config files are created with your settings' + NewLine +
    Space + '2. AutoTrack components are downloaded (3-4 GB, 5-15 min)' + NewLine +
    Space + '3. A desktop shortcut is created' + NewLine +
    Space + '4. Double-click AutoTrack to open the app' + NewLine +
    Space + '5. Register as Admin — cloud connection is automatic';
end;

// ── Uninstall: offer to stop and remove Docker containers ─────────────────────
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    if MsgBox(
      'Do you want to stop and remove the AutoTrack Docker containers?' + #13#10 +
      '(Your vehicle data will be preserved)',
      mbConfirmation, MB_YESNO
    ) = IDYES then begin
      Exec(
        'cmd.exe',
        '/k "cd /d C:\AutoTrack && docker compose down && timeout /t 3"',
        'C:\AutoTrack',
        SW_SHOW,
        ewWaitUntilTerminated,
        ResultCode
      );
    end;
  end;
end;
