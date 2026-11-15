@echo off
rem Double-click to start Scoreboard: runs the local server in a minimized
rem window (close that window to stop it) and opens the board in your browser.
rem If the server is already running, it just opens the board.
cd /d "%~dp0"
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if errorlevel 1 start "Scoreboard server" /min python server.py 5173
timeout /t 1 /nobreak >nul
start "" http://localhost:5173
