# Contributing to aiblame

Thanks for taking the time to help. Bug reports, ideas, docs fixes and code are all welcome.

## Before you start

- **Bugs:** open an [issue](https://github.com/celaldrg/aiblame/issues/new/choose) with steps to reproduce.
- **Bigger changes:** open an issue first so we can agree on the approach before you spend time on it.
- **First contribution?** Look for issues labeled [`good first issue`](https://github.com/celaldrg/aiblame/labels/good%20first%20issue).

## Development setup

You need Node.js 20 or newer.

```sh
git clone https://github.com/celaldrg/aiblame
cd aiblame
npm ci
npm run build
npm test
node dist/cli.js # run it on this repo
```

## Adding a new agent

Most contributions will be new agent signatures. They live in [`src/agents.ts`](src/agents.ts).

1. Find a **public, self-declared** signal: a co-author trailer, a bot account or a footer the tool writes by itself. Link to an example commit in your PR.
2. Make the pattern strict enough that it can never match a human (people are called Claude, Devin and Jules).
3. Add a positive *and* a negative case to [`tests/detect.test.ts`](tests/detect.test.ts).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Add or update tests for any behavior change. CI must pass.
4. Update the README if you change flags, output or behavior users can see.
5. Describe what changed and why in the pull request.

Commit messages: short imperative summary (`Add --quiet flag`, `Fix parsing of quoted values`).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By taking part you agree to follow it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
