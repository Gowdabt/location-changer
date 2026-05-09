# macOS Signing and Notarization Checklist

## Prerequisites

- Apple Developer account with Developer ID Application certificate
- App-specific password for notarization
- Xcode command line tools available

## Environment variables (CI/local)

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `CSC_NAME` (certificate common name)

## Certificate setup

1. Export Developer ID Application cert as `.p12` from Keychain.
2. Import into build machine keychain.
3. Verify certificate availability:
   - `security find-identity -v -p codesigning`

## Build and sign

1. Build app package:
   - `npm run dist:mac -w apps/desktop`
2. Verify signature:
   - `codesign --verify --deep --strict --verbose=2 "apps/desktop/release/*.app"`

## Notarization

1. Submit artifact:
   - `xcrun notarytool submit <artifact.dmg> --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait`
2. Staple ticket:
   - `xcrun stapler staple <artifact.dmg>`
3. Validate gatekeeper:
   - `spctl -a -vvv -t install <artifact.dmg>`

## Notes

- Keep unsigned build path available for local testing.
- Never commit secrets or certificate files into the repository.
