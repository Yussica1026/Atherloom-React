@echo off
set "VITE_API_PROXY_TARGET=http://127.0.0.1:8923"
call npm.cmd run dev -- --host 127.0.0.1 --port 5223
