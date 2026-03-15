# Contributing to X-Computer

Thank you for your interest in contributing to X-Computer! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- Node.js 22+
- npm 9+
- Docker (optional, for container isolation)
- MySQL or SQLite

### Development Setup

```bash
# Clone the repository
git clone https://github.com/RogerLiNing/x-computer.git
cd x-computer

# Install dependencies
npm install

# Copy example config
cp .x-config.example.json .x-config.json
# Edit .x-config.json with your LLM API keys

# Start development server
npm run dev
```

The frontend will be available at `http://localhost:3000` and the backend API at `http://localhost:4000`.

## Project Structure

```
x-computer/
├── frontend/          # React frontend (Desktop UI)
├── server/            # Node.js backend (API + Agent Orchestrator)
├── shared/            # Shared TypeScript types
├── workflow-engine/   # Optional workflow microservice
├── marketing/         # Marketing landing page (Next.js)
└── docs/              # Documentation
```

## How to Contribute

### Reporting Bugs

1. Search existing issues to avoid duplicates
2. Use the bug report template
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, browser)
   - Screenshots or logs if applicable

### Suggesting Features

1. Check the [REQUIREMENTS.md](docs/REQUIREMENTS.md) for planned features
2. Open a discussion or issue with the `enhancement` label
3. Describe the use case and proposed solution

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm run test`
5. Commit with clear messages: `git commit -m "feat: add new feature"`
6. Push and create a Pull Request

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Examples:
```
feat: add subscription management app
fix: resolve WebSocket reconnection issue
docs: update deployment guide
```

## Code Guidelines

### TypeScript

- Use TypeScript for all new code
- Define types in `shared/src/index.ts` for shared contracts
- Avoid `any` type; use proper typing

### Frontend (React)

- Use functional components with hooks
- State management via Zustand
- Follow existing component patterns in `frontend/src/components/`
- Use Tailwind CSS for styling

### Backend (Node.js)

- Express 5 for REST API
- WebSocket for real-time updates
- Tests in `*.test.ts` files using Vitest

### Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
cd server && npm run test:watch
```

## Areas for Contribution

### Good First Issues

Look for issues labeled `good first issue` - these are beginner-friendly tasks.

### High-Impact Areas

- **Internationalization**: Adding new language translations
- **Documentation**: Improving guides and API docs
- **Testing**: Increasing test coverage
- **Accessibility**: Improving keyboard navigation and screen reader support
- **Performance**: Optimizing frontend rendering and backend queries

### Feature Development

Check [REQUIREMENTS.md](docs/REQUIREMENTS.md) for planned features with priorities:
- P0: Critical / In progress
- P1: High priority
- P2: Medium priority
- P3: Nice to have

## Communication

- **Issues**: Bug reports and feature requests
- **Discussions**: General questions and ideas
- **Pull Requests**: Code contributions

## License

By contributing to X-Computer, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🎉
