"""Helpers for tools/shortcut/sign-selfsigned.sh (Python standard library only).

  x963 <leaf.key> <key.bin>            raw X9.63 P-256 key (0x04 | X | Y | d), the format shortcut-sign wants
  auth <leaf.der> <root.der> <auth>    auth data: binary plist { SigningCertificateChain: [leaf, root] }
  binplist <in.plist> <out.plist>      the Shortcut as a binary plist (what Apple's own files contain)
  profile <root.der> <out.mobileconfig> an iPhone profile that installs the root certificate
"""
import plistlib
import re
import subprocess
import sys
import uuid


def x963(key_pem, out):
    text = subprocess.run(["openssl", "ec", "-in", key_pem, "-noout", "-text"], capture_output=True, text=True, check=True).stdout
    def block(name, end):
        m = re.search(name + r":\s*((?:[0-9a-f]{2}:?\s*)+)" + end, text, re.S)
        return bytes.fromhex(re.sub(r"[^0-9a-f]", "", m.group(1)))
    priv = block("priv", "pub:")[-32:].rjust(32, b"\0")
    pub = block("pub", "ASN1 OID")
    if len(pub) != 65 or pub[0] != 4:
        sys.exit("unexpected public key format")
    with open(out, "wb") as f:
        f.write(pub + priv)


def auth(leaf, root, out):
    chain = [open(leaf, "rb").read(), open(root, "rb").read()]
    with open(out, "wb") as f:
        plistlib.dump({"SigningCertificateChain": chain}, f, fmt=plistlib.FMT_BINARY)


def binplist(src, out):
    with open(src, "rb") as f:
        data = plistlib.load(f)
    with open(out, "wb") as f:
        plistlib.dump(data, f, fmt=plistlib.FMT_BINARY, sort_keys=False)


def profile(root, out):
    cert = {
        "PayloadType": "com.apple.security.root",
        "PayloadVersion": 1,
        "PayloadIdentifier": "app.motus.shortcut-signing.cert",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadDisplayName": "Motus Shortcut signing (temporary)",
        "PayloadCertificateFileName": "motus-shortcut-signing.cer",
        "PayloadContent": open(root, "rb").read(),
    }
    config = {
        "PayloadType": "Configuration",
        "PayloadVersion": 1,
        "PayloadIdentifier": "app.motus.shortcut-signing",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadDisplayName": "Motus Shortcut signing (temporary)",
        "PayloadDescription": "Lets this iPhone add the Motus Shortcut. Its private key was destroyed right after signing, "
                              "so nothing new can ever be signed with it. Remove this profile once Motus is added.",
        "PayloadOrganization": "Motus",
        "PayloadRemovalDisallowed": False,
        "PayloadContent": [cert],
    }
    with open(out, "wb") as f:
        plistlib.dump(config, f, fmt=plistlib.FMT_XML)


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"x963": x963, "auth": auth, "binplist": binplist, "profile": profile}[cmd](*args)
