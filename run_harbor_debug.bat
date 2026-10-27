@echo off
cd /d "C:\Users\glpc_\My projects\Harbor-beta-branch\src-tauri"
cargo run --no-default-features > "C:\Users\glpc_\My projects\Harbor-beta-branch\debug_run.log" 2>&1
echo EXIT_CODE=%ERRORLEVEL% >> "C:\Users\glpc_\My projects\Harbor-beta-branch\debug_run.log"
