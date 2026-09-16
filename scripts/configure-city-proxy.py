#!/usr/bin/env python3
"""Replace only the existing demo.glint.sh block, validate, and reload Caddy."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

path=Path("/etc/caddy/Caddyfile")
original=path.read_text()
lines=original.splitlines(keepends=True)
start=next((i for i,line in enumerate(lines) if line.strip()=="demo.glint.sh {"),None)
if start is None: raise SystemExit("Expected existing demo.glint.sh block; refusing to change another site")
depth=0
for end in range(start,len(lines)):
    depth+=lines[end].count("{")-lines[end].count("}")
    if depth==0: break
else: raise SystemExit("Unbalanced existing site block")
block="""demo.glint.sh {
    encode zstd gzip
    reverse_proxy 127.0.0.1:43174 {
        flush_interval -1
        transport http {
            dial_timeout 5s
            read_timeout 0
            write_timeout 0
        }
    }
}
"""
updated="".join(lines[:start])+block+"".join(lines[end+1:])
if updated==original:
    print("City proxy already points to the application")
    sys.exit(0)
stamp=time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())
backup=path.with_name(f"Caddyfile.before-axp-{stamp}")
shutil.copy2(path,backup)
backup.chmod(0o600)
candidate=path.with_name(".Caddyfile.axp-candidate")
candidate.write_text(updated)
candidate.chmod(0o644)
check=subprocess.run(["caddy","validate","--config",str(candidate),"--adapter","caddyfile"],capture_output=True,text=True)
if check.returncode:
    candidate.unlink()
    raise SystemExit("Caddy validation failed: "+check.stderr)
if path.read_text()!=original:
    candidate.unlink()
    raise SystemExit("Caddy changed concurrently; retry from its current contents")
os.replace(candidate,path)
try:
    subprocess.run(["systemctl","reload","caddy"],check=True,capture_output=True)
except subprocess.CalledProcessError:
    if path.read_text()==updated:
        path.write_text(original)
        subprocess.run(["systemctl","reload","caddy"],check=False,capture_output=True)
    raise
print("Updated only demo.glint.sh; backup:",backup)
