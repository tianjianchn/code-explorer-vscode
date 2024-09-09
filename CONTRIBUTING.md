## Dev

```bash
git clone git@github.com:tianjianchn/code-explorer-vscode.git
cd code-explorer-vscode
npm i
```

## Debug

- Open Debug activity bar in VSCode
- Click `Run Extension` which will spawn a new dev VSCode Window

## Publish

- Update [CHANGELOG.md](./CHANGELOG.md) from git commits and increase version in [package.json](./package.json)
- Commit with message like `release: <version>`
- Use `vsce package` to create the vsix file
- Upload it to [VSCode Market](https://marketplace.visualstudio.com/manage)
