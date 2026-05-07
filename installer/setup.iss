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

[Icons]
Name: "{commondesktop}\AutoTrack"; Filename: "{app}\AutoTrack.exe"; Comment: "Open AutoTrack Workshop Manager"

[Code]

var
  BranchPage: TInputQueryWizardPage;
  RTSPPage:   TInputQueryWizardPage;
  APIKeyPage: TInputQueryWizardPage;

// ── Generate a random 64-char hex JWT key using Pascal only — no PowerShell ──
function GenerateJWTKey: String;
var
  i: Integer;
  key: String;
  chars: String;
  t: Cardinal;
begin
  chars := '0123456789ABCDEF';
  key   := '';
  t     := GetTickCount;
  // Seed with tick count + process time for reasonable randomness
  for i := 1 to 64 do begin
    t   := (t * 1103515245 + 12345) and $7FFFFFFF;
    key := key + chars[(t mod 16) + 1];
  end;
  Result := key;
end;

// ── Check Docker Desktop is installed ─────────────────────────────────────────
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
  BranchPage := CreateInputQueryPage(
    wpWelcome,
    'Branch Name',
    'What is the name of this branch location?',
    'This name will appear in the admin dashboard to identify this branch.'
  );
  BranchPage.Add('Branch Name:', False);
  BranchPage.Values[0] := 'Main Branch';

  RTSPPage := CreateInputQueryPage(
    BranchPage.ID,
    'Camera Setup',
    'Enter your IP camera RTSP URL',
    'Leave blank to set later from the app Settings menu.'
  );
  RTSPPage.Add('RTSP URL (leave blank to skip):', False);
  RTSPPage.Values[0] := '';

  APIKeyPage := CreateInputQueryPage(
    RTSPPage.ID,
    'Cloud Connection',
    'Enter the Branch API Key',
    'The super admin generates this from the cloud dashboard.' + #13#10 +
    'Leave blank if you don''t have it yet — configure later in Branch Sync.'
  );
  APIKeyPage.Add('Branch API Key (leave blank to skip):', False);
  APIKeyPage.Values[0] := '';
end;

// ── Block if Docker not installed ─────────────────────────────────────────────
function InitializeSetup: Boolean;
begin
  Result := True;
  if not DockerInstalled then begin
    MsgBox(
      'Docker Desktop is not installed.' + #13#10 + #13#10 +
      'Please install it from https://www.docker.com/products/docker-desktop' + #13#10 +
      'then run this installer again.',
      mbError, MB_OK
    );
    Result := False;
  end;
end;

// ── Validate branch name ───────────────────────────────────────────────────────
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

// ── Write all config files directly from Pascal — no PowerShell needed ────────
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode:      Integer;
  InstallDir:      String;
  BackendDir:      String;
  DataDir:         String;
  JWTKey:          String;
  EnvContent:      String;
  ConfigContent:   String;
  ApiKey:          String;
  BranchName:      String;
  RTSPUrl:         String;
begin
  if CurStep = ssPostInstall then begin
    InstallDir := ExpandConstant('{app}');
    BackendDir := InstallDir + '\backend';
    DataDir    := BackendDir + '\data';

    // Create directories
    ForceDirectories(BackendDir);
    ForceDirectories(DataDir);

    // Generate JWT secret key
    JWTKey     := GenerateJWTKey;
    BranchName := BranchPage.Values[0];
    RTSPUrl    := RTSPPage.Values[0];
    ApiKey     := APIKeyPage.Values[0];

    // Write backend\.env  — pure Pascal, no PowerShell
    EnvContent :=
      'JWT_SECRET_KEY=' + JWTKey                                                                      + #13#10 +
      ''                                                                                              + #13#10 +
      'RTSP_URL=' + RTSPUrl                                                                           + #13#10 +
      ''                                                                                              + #13#10 +
      'ALLOWED_ORIGINS=http://localhost,http://localhost:5173,http://localhost:4173'                  + #13#10 +
      'LOG_LEVEL=INFO'                                                                                + #13#10 +
      'IMAGE_RETENTION_DAYS=30'                                                                       + #13#10 +
      ''                                                                                              + #13#10 +
      'S3_ENDPOINT_URL=https://6aad6ffcea8c29770bf2afafb6cb7209.r2.cloudflarestorage.com'            + #13#10 +
      'S3_ACCESS_KEY_ID=44b785c8c2e1514ffb77336e4260b21f'                                            + #13#10 +
      'S3_SECRET_ACCESS_KEY=26702d93588cbcd236d32de3040824107e4adc186e5b195363c06ca711a72623'        + #13#10 +
      'S3_BUCKET_NAME=autotrack-images'                                                              + #13#10 +
      'S3_PUBLIC_URL=https://pub-0c5f3e700bce4ecca623010ae3a76e47.r2.dev'                            + #13#10 +
      ''                                                                                              + #13#10 +
      'SENTRY_DSN=';

    SaveStringToFile(BackendDir + '\.env', EnvContent, False);

    // Write initial_config.json for auto cloud connection (if API key provided)
    if ApiKey <> '' then begin
      ConfigContent :=
        '{' + #13#10 +
        '  "cloud_url":     "http://13.63.172.65/api",' + #13#10 +
        '  "cloud_api_key": "' + ApiKey + '",' + #13#10 +
        '  "branch_name":   "' + BranchName + '"' + #13#10 +
        '}';
      SaveStringToFile(DataDir + '\initial_config.json', ConfigContent, False);
    end;

    // Pull Docker images
    Exec(
      'cmd.exe',
      '/k "echo. && ' +
          'echo  Downloading AutoTrack components... && ' +
          'echo  This takes 5-15 minutes. Do NOT close this window. && ' +
          'echo. && ' +
          'cd /d "' + InstallDir + '" && ' +
          'docker compose pull && ' +
          'echo. && echo  Done! Close this window. && ' +
          'timeout /t 5 && exit"',
      InstallDir,
      SW_SHOW,
      ewWaitUntilTerminated,
      ResultCode
    );
  end;
end;

// ── Summary before install ────────────────────────────────────────────────────
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  APIDisplay: String;
  RTSPDisplay: String;
begin
  if APIKeyPage.Values[0] = '' then
    APIDisplay := '(set later in Branch Sync)'
  else
    APIDisplay := Copy(APIKeyPage.Values[0], 1, 8) + '...';

  if RTSPPage.Values[0] = '' then
    RTSPDisplay := '(set later in Settings)'
  else
    RTSPDisplay := RTSPPage.Values[0];

  Result :=
    'Branch Name:   ' + BranchPage.Values[0] + NewLine +
    'Camera URL:    ' + RTSPDisplay + NewLine +
    'Cloud API Key: ' + APIDisplay + NewLine +
    NewLine +
    'Install folder: C:\AutoTrack' + NewLine +
    NewLine +
    'What happens next:' + NewLine +
    Space + '1. Config files written automatically' + NewLine +
    Space + '2. Docker images downloaded (5-15 min)' + NewLine +
    Space + '3. Double-click AutoTrack on desktop to start';
end;

// ── Uninstall ─────────────────────────────────────────────────────────────────
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    if MsgBox('Stop and remove AutoTrack Docker containers?',
              mbConfirmation, MB_YESNO) = IDYES then
      Exec('cmd.exe',
        '/k "cd /d C:\AutoTrack && docker compose down && timeout /t 3"',
        'C:\AutoTrack', SW_SHOW, ewWaitUntilTerminated, ResultCode);
  end;
end;
