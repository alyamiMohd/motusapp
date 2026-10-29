#!/usr/bin/env bash
# Signs the Motus Shortcut without a Mac, for the owner's iPhone only (run by .github/workflows/sign-shortcut.yml).
#
# iPhones only add signed Shortcut files. This signs it with a throwaway certificate pair, the way ShortSign
# (github.com/dan1165/ShortSign) does: a root certificate and a signing certificate under it, both inside the file.
# The iPhone accepts the file once that root is installed and fully trusted (motus-shortcut-signing.mobileconfig).
# The owner then shares it as an iCloud link, which Apple re-signs itself, and removes the profile again.
#
# Both private keys exist only on this throwaway machine: the root key is deleted as soon as it has signed the
# signing certificate (so nothing new can ever be issued under the root the iPhone trusts), the signing key as soon
# as the Shortcut is signed. Nothing secret is printed.
#
# usage: sign-selfsigned.sh <shortcut-sign source dir> <out dir>
set -euo pipefail
SS="$1" OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

# 1. Build shortcut-sign (MIT, 0xilis). One fix on top: AEA keeps a SHA-256 of each uncompressed segment right
#    after its two size fields, and libshortcutsign leaves the one from its built-in template in place.
LIB="$SS/lib/libshortcutsign/sign.c"
grep -q "segmentHeader->compressedSize = compressedSize;" "$LIB"
sed -i 's|segmentHeader->compressedSize = compressedSize;|&\n        { unsigned int n = 0; EVP_Digest(originalFileSegment, segmentSize, ((uint8_t *)segmentHeader) + 8, \&n, EVP_sha256(), NULL); }|' "$LIB"
grep -q "EVP_Digest(originalFileSegment" "$LIB"
make -C "$SS" > "$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log"; exit 1; }
SIGN="$SS/build/usr/bin/shortcut-sign"
"$SIGN" version || true

# 2. The testing certificate when the repo has one (secrets MOTUS_SIGN_KEY, MOTUS_SIGN_CERT, MOTUS_SIGN_ROOT, made once
#    by the owner's choice on 2026-10-29 so the iPhone trusts one profile for the testing period; its root key was
#    destroyed when it signed the leaf), otherwise a fresh throwaway pair, valid for 30 days.
if [ -n "${MOTUS_SIGN_KEY:-}" ]; then
  printf '%s\n' "$MOTUS_SIGN_KEY" > "$WORK/leaf.key"
  printf '%s\n' "$MOTUS_SIGN_CERT" > "$WORK/leaf.pem"
  printf '%s\n' "$MOTUS_SIGN_ROOT" > "$WORK/root.pem"
  echo "using the testing certificate"
else
cat > "$WORK/ext.cnf" <<'EOF'
[req]
distinguished_name = dn
[dn]
[root]
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
1.2.840.113635.100.18.1 = ASN1:UTF8String:Motus
[leaf]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth,clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
1.2.840.113635.100.18.1 = ASN1:UTF8String:Motus
EOF
serial() { echo "0x$(openssl rand -hex 8 | sed 's/^[89a-f]/7/')"; }
openssl ecparam -name prime256v1 -genkey -noout -out "$WORK/root.key"
openssl req -new -x509 -key "$WORK/root.key" -subj "/C=SA/O=Motus/CN=Motus Shortcut signing (temporary)" \
  -days 30 -sha256 -set_serial "$(serial)" -config "$WORK/ext.cnf" -extensions root -out "$WORK/root.pem"
openssl ecparam -name prime256v1 -genkey -noout -out "$WORK/leaf.key"
openssl req -new -key "$WORK/leaf.key" -subj "/C=SA/O=Motus/CN=Motus Shortcut" -config "$WORK/ext.cnf" -out "$WORK/leaf.csr"
openssl x509 -req -in "$WORK/leaf.csr" -CA "$WORK/root.pem" -CAkey "$WORK/root.key" -set_serial "$(serial)" \
  -days 30 -sha256 -extfile "$WORK/ext.cnf" -extensions leaf -out "$WORK/leaf.pem"
shred -u "$WORK/root.key"                  # nothing can ever be issued under this root again
fi
openssl verify -CAfile "$WORK/root.pem" "$WORK/leaf.pem"
openssl x509 -in "$WORK/root.pem" -outform DER -out "$WORK/root.der"
openssl x509 -in "$WORK/leaf.pem" -outform DER -out "$WORK/leaf.der"

# 3. Sign the Shortcut.
python3 "$HERE/selfsign.py" x963 "$WORK/leaf.key" "$WORK/key.bin"
python3 "$HERE/selfsign.py" auth "$WORK/leaf.der" "$WORK/root.der" "$WORK/auth.plist"
node "$HERE/build.mjs"
python3 "$HERE/selfsign.py" binplist "$HERE/dist/Motus.unsigned.plist" "$WORK/Motus.plist"
"$SIGN" sign -i "$WORK/Motus.plist" -o "$OUT/Motus.shortcut" -k "$WORK/key.bin" -a "$WORK/auth.plist"
shred -u "$WORK/key.bin" "$WORK/leaf.key"

# 4. Check it: the signature holds, and what comes out is exactly what went in.
"$SIGN" verify -i "$OUT/Motus.shortcut"
"$SIGN" info -i "$OUT/Motus.shortcut" || true
"$SIGN" extract -i "$OUT/Motus.shortcut" -o "$WORK/extracted.plist"
cmp "$WORK/Motus.plist" "$WORK/extracted.plist" && echo "extracted Shortcut is identical to the one signed"
head -c 4 "$OUT/Motus.shortcut" | grep -q AEA1 && echo "file starts with AEA1"

# 5. The profile that lets the owner's iPhone trust the root.
python3 "$HERE/selfsign.py" profile "$WORK/root.der" "$OUT/motus-shortcut-signing.mobileconfig"
openssl x509 -in "$WORK/root.pem" -noout -subject -enddate -fingerprint -sha256
ls -la "$OUT"
