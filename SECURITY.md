# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email security details to: [security@x-computer.dev](mailto:security@x-computer.dev)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- We will acknowledge receipt within 48 hours
- We will investigate and provide an initial assessment within 7 days
- We will work with you to understand and resolve the issue
- We will credit you in the security advisory (unless you prefer anonymity)

### Scope

Security issues we're interested in:

- Authentication/authorization bypasses
- Remote code execution
- SQL injection
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Sensitive data exposure
- Container escape vulnerabilities

### Out of Scope

- Issues in dependencies (please report to the dependency maintainers)
- Issues requiring physical access to a user's device
- Social engineering attacks
- Denial of service attacks that require excessive resources

## Security Best Practices

When deploying X-Computer:

1. **Never commit secrets** — Use environment variables or `{env:VAR_NAME}` placeholders
2. **Enable container isolation** — Set `container.enabled: true` in production
3. **Use HTTPS** — Always deploy behind HTTPS in production
4. **Keep updated** — Regularly update to the latest version
5. **Review audit logs** — Monitor the audit trail for suspicious activity

See [Security Hardening Guide](docs/SECURITY_HARDENING_COMPLETE.md) for detailed security recommendations.
