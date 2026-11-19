#!/usr/bin/env python3
"""Make android/app/build.gradle sign the release APK with the private key.

The key file and passwords come from environment variables at build time
(KS_PASS, KEY_ALIAS, KEY_PASS); nothing secret is written into the project.
"""
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'android/app/build.gradle'
s = open(path, encoding='utf-8').read()

CONFIG = """    signingConfigs {
        release {
            storeFile file('dara-release.keystore')
            storePassword System.getenv('KS_PASS')
            keyAlias System.getenv('KEY_ALIAS')
            keyPassword System.getenv('KEY_PASS')
        }
"""
HEAD = '    signingConfigs {\n'
USE = 'signingConfig signingConfigs.debug'

if s.count(HEAD) != 1:
    sys.exit('signingConfigs block not found exactly once')
s = s.replace(HEAD, CONFIG, 1)
i = s.index('    buildTypes {')
j = s.index('        release {', i)
k = s.index(USE, j)
s = s[:k] + 'signingConfig signingConfigs.release' + s[k + len(USE):]
open(path, 'w', encoding='utf-8').write(s)
print('release signing patched')
