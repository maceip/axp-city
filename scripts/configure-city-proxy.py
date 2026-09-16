#!/usr/bin/env python3
"""Replace only the existing demo.glint.sh block, validate, and reload Caddy."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
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
metadata=path.stat()
with tempfile.NamedTemporaryFile(mode="w",prefix=".Caddyfile.axp-",dir=path.parent,delete=False) as output:
    output.write(updated)
    candidate=Path(output.name)
check=subprocess.run(["caddy","validate","--config",str(candidate),"--adapter","caddyfile"],capture_output=True,text=True)
if check.returncode:
    candidate.unlink()
    raise SystemExit("Caddy validation failed: "+check.stderr)
if path.read_text()!=original:
    candidate.unlink()
    raise SystemExit("Caddy changed concurrently; retry from its current contents")
# Retain the existing config's ownership and access, including protected secrets
# for unrelated sites. Temporary candidates are private until validation finishes.
os.chown(candidate,metadata.st_uid,metadata.st_gid)
candidate.chmod(metadata.st_mode & 0o777)
os.replace(candidate,path)
try:
    subprocess.run(["systemctl","reload","caddy"],check=True,capture_output=True)
except subprocess.CalledProcessError:
    if path.read_text()==updated:
        path.write_text(original)
        subprocess.run(["systemctl","reload","caddy"],check=False,capture_output=True)
    raise
print("Updated only demo.glint.sh; backup:",backup)
