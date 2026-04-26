#define MyAppName      "AutoTrack Branch"
#define MyAppVersion   "1.0"
#define MyAppPublisher "AutoTrack"
#define MyAppURL       "http://localhost"

[Setup]
AppId={{8F3A2D1B-4C5E-6F7A-8B9C-0D1E2F3A4B5C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName=C:\AutoTrack
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=AutoTrack-Branch-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
MinVersion=10.0
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Project source files — everything needed to build and run the Docker containers.
; Each entry must be a single line in Inno Setup.
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion skipifsourcedoesntexist; Excludes: "node_modules\*,.backend_venv\*,backend\.backend_venv\*,dist\*,.git\*,*.db,autotrack.log,backend\.env,backend\uploads\*,installer\output\*,backend_err.txt,backend_log.txt,frontend_log.txt,color_detector.ipynb,test\*,test_rtsp.py"
; Installer helper script — placed in {tmp} and auto-deleted after installation.
Source: "write_env.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
; Each icon entry must be a single line — no line breaks allowed.
Name: "{commondesktop}\AutoTrack Workshop"; Filename: "powershell.exe"; Parameters: "-WindowStyle Hidden -Command ""Start-Process 'http://localhost'"""; WorkingDir: "{app}"; Comment: "Open AutoTrack Workshop Manager"
Name: "{group}\Open AutoTrack"; Filename: "powershell.exe"; Parameters: "-WindowStyle Hidden -Command ""Start-Process 'http://localhost'"""; WorkingDir: "{app}"
Name: "{group}\Start AutoTrack"; Filename: "powershell.exe"; Parameters: "-NoExit -Command ""Set-Location '{app}'; docker compose up -d; Write-Host 'AutoTrack started. Open http://localhost'"""; WorkingDir: "{app}"
Name: "{group}\Stop AutoTrack"; Filename: "powershell.exe"; Parameters: "-NoExit -Command ""Set-Location '{app}'; docker compose down; Write-Host 'AutoTrack stopped.'"""; WorkingDir: "{app}"
Name: "{group}\View Backend Logs"; Filename: "powershell.exe"; Parameters: "-NoExit -Command ""Set-Location '{app}'; docker compose logs -f backend"""; WorkingDir: "{app}"
Name: "{group}\Uninstall AutoTrack"; Filename: "{uninstallexe}"

[Code]
var
  BranchPage: TInputQueryWizardPage;
  RTSPPage:   TInputQueryWizardPage;

// ── Check Docker Desktop is installed and running ────────────────────────────
function DockerInstalled: Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c docker info >nul 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
            and (ResultCode = 0);
end;

// ── Wizard setup ─────────────────────────────────────────────────────────────
procedure InitializeWizard;
begin
  // Page 1: Branch Name (informational — user configures cloud sync in the app later)
  BranchPage := CreateInputQueryPage(wpWelcome,
    'Branch Identity',
    'What is the name of this branch location?',
    'This is shown in the cloud dashboard to identify which branch this PC belongs to.' + #13#10 +
    'You will finish connecting to the cloud from inside the app after installation.');
  BranchPage.Add('Branch Name:', False);
  BranchPage.Values[0] := 'Main Workshop';

  // Page 2: RTSP Camera URL
  RTSPPage := CreateInputQueryPage(BranchPage.ID,
    'Camera Setup',
    'Enter your IP camera''s RTSP URL',
    'Leave blank if you don''t have a camera yet — you can set this later from' + #13#10 +
    'the app''s Settings menu (camera icon in the header).');
  RTSPPage.Add('RTSP URL (leave blank to skip):', False);
  RTSPPage.Values[0] := '';
end;

// ── Block install if Docker is missing ───────────────────────────────────────
function InitializeSetup: Boolean;
begin
  Result := True;
  if not DockerInstalled then begin
    Result := MsgBox(
      'Docker Desktop is not installed or not running.' + #13#10 + #13#10 +
      'AutoTrack requires Docker Desktop to run.' + #13#10 +
      'Download it from: https://www.docker.com/products/docker-desktop' + #13#10 + #13#10 +
      'Install Docker Desktop first, start it, then re-run this installer.' + #13#10 + #13#10 +
      'Continue anyway? (Not recommended)',
      mbConfirmation, MB_YESNO) = IDYES;
  end;
end;

// ── Validate wizard inputs ────────────────────────────────────────────────────
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = BranchPage.ID then begin
    if Trim(BranchPage.Values[0]) = '' then begin
      MsgBox('Please enter a branch name.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// ── Post-install actions ─────────────────────────────────────────────────────
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PSArgs:     String;
begin
  if CurStep = ssPostInstall then begin

    // Step 1: Write the RTSP URL to a temp file so write_env.ps1 can read it
    // safely — avoids shell escaping issues with special chars in camera URLs.
    SaveStringToFile(ExpandConstant('{tmp}\autotrack_rtsp.txt'),
                     RTSPPage.Values[0], False);

    // Step 2: Call write_env.ps1 to generate JWT secret and write backend/.env
    PSArgs := '-ExecutionPolicy Bypass -NonInteractive -File "' +
              ExpandConstant('{tmp}\write_env.ps1') + '"' +
              ' -InstallDir "' + ExpandConstant('{app}') + '"';

    if not Exec('powershell.exe', PSArgs, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      MsgBox('Warning: could not write backend/.env. Please create it manually before starting AutoTrack.', mbError, MB_OK);

    // Step 3: Launch Docker build in a visible terminal.
    // The build downloads ~1 GB of layers and takes 15-60 minutes on first run.
    Exec('cmd.exe',
      '/k "echo. && echo ============================================ && ' +
          'echo  AutoTrack is building for the first time. && ' +
          'echo  This takes 15-60 minutes depending on internet speed. && ' +
          'echo  You can close this window - the build continues in the background. && ' +
          'echo ============================================ && echo. && ' +
          'cd /d "' + ExpandConstant('{app}') + '" && ' +
          'docker compose up -d --build"',
      ExpandConstant('{app}'),
      SW_SHOW,
      ewNoWait,
      ResultCode);
  end;
end;

// ── Ready memo — summary shown before installation starts ────────────────────
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  RTSPDisplay: String;
begin
  if RTSPPage.Values[0] = '' then
    RTSPDisplay := '(not set — configure in app settings)'
  else
    RTSPDisplay := RTSPPage.Values[0];

  Result :=
    'Branch:      ' + BranchPage.Values[0] + NewLine +
    'Camera URL:  ' + RTSPDisplay + NewLine +
    NewLine +
    MemoDirInfo + NewLine +
    NewLine +
    'What happens after you click Install:' + NewLine +
    Space + '1. Project files are copied to the install folder' + NewLine +
    Space + '2. A secure config file is generated automatically' + NewLine +
    Space + '3. A terminal opens and starts the Docker build (15-60 min)' + NewLine +
    Space + '4. When the build finishes, open http://localhost' + NewLine +
    Space + '5. Sign up as Admin, then Profile > Branch Sync to connect to cloud';
end;

// ── Uninstall: offer to stop and remove Docker containers ────────────────────
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    if MsgBox(
      'Stop and remove the AutoTrack Docker containers?' + #13#10 +
      '(Vehicle data stored in Docker volumes will be preserved)',
      mbConfirmation, MB_YESNO) = IDYES then begin
      Exec('cmd.exe',
        '/k "cd /d "' + ExpandConstant('{app}') + '" && docker compose down && echo Done. && timeout /t 3"',
        ExpandConstant('{app}'), SW_SHOW, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;
