# CodeGuard

CodeGuard is an AI-powered security testing platform that automates vulnerability detection, analysis, and remediation. The system combines multiple runtime environments, specialized AI agents, and a modular skill system to provide comprehensive security scanning capabilities for applications and repositories.

## Architecture

CodeGuard employs a multi-runtime backend architecture designed for performance and reliability:

| Runtime | Service | Port | Responsibility |
|---|---|---|---|
| Python | `python-api` | 9000 | FastAPI contracts, scan orchestration, AI routing, MongoDB/Redis coordination, remediation workflows |
| Rust | `rust-indexer` | 7100 | Native bounded repository indexing and hotspot pre-analysis |

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Components**: Shadcn UI with Radix UI primitives
- **Desktop**: Electron for cross-platform desktop application
- **State Management**: TanStack Query for server state
- **Routing**: React Router v6
- **Styling**: Tailwind CSS

## Key Features

### AI-Powered Security Testing
- **Multi-Agent System**: Specialized agents for detection, explanation, fix generation, penetration testing, and validation
- **Agent Orchestration**: Policy engine with memory management and context compaction
- **Model Router**: Multi-provider AI configuration with intelligent routing
- **Skill System**: Modular, extensible skill-based testing capabilities

### Security Capabilities
- **Vulnerability Detection**: Automated identification of security issues across multiple domains
- **Penetration Testing**: AI-driven penetration testing with sandboxed execution
- **Remediation**: AI-generated fix suggestions with validation and rollback capabilities
- **Coverage Tracking**: Comprehensive coverage analysis for security scans

### Specialized Security Skills
The platform includes specialized skills for various security domains:
- **Web Vulnerabilities**: IDOR, BAC, injection attacks, SSRF, XSS
- **Authentication**: JWT attacks (algorithm confusion, key manipulation, weak secrets)
- **API Security**: GraphQL analysis, race conditions, deserialization attacks
- **Infrastructure**: SSRF, takeover vulnerabilities, service reconnaissance

### Intelligence and Learning
- **Continuous Learning**: External knowledge ingestion and feedback integration
- **Repository Intelligence**: Hotspot detection and service exposure analysis
- **Team Posture**: Security posture tracking and reporting
- **Benchmark System**: Security benchmarking and performance metrics

## Getting Started

### Prerequisites
- Python 3.10+ (for Python API)
- Rust and Cargo (optional, for Rust indexer)
- MongoDB and Redis (for data persistence and queue)
- Bun (for frontend development)

### Backend Setup

1. **Install Python Dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Build Rust Indexer** (optional but recommended):
   ```bash
   cd backend/rust-indexer
   cargo build --release
   ```

3. **Start All Backend Services**:
   ```bash
   cd backend
   python main.py
   ```

   This starts the Python API and the Rust indexer (if built) automatically.

### Frontend Setup

1. **Install Dependencies**:
   ```bash
   bun install
   ```

2. **Development Mode**:
   ```bash
   bun run dev
   ```

3. **Desktop Application**:
   ```bash
   bun run electron:dev
   ```

4. **Build for Production**:
   ```bash
   bun run electron:build:win
   ```

### API Access

The main API endpoint is:
```
http://127.0.0.1:9000/api/v1
```

Available endpoints:
- `/scans` - Scan management and execution
- `/sessions` - Session management
- `/remediation` - Fix generation and application
- `/learning` - Learning system integration
- `/settings` - Runtime configuration
- `/skills` - Skill registry and management
- `/coverage` - Coverage analysis
- `/health` - System health checks

## Project Structure

```
codeguard/
├── backend/
│   ├── app/                          # Python FastAPI application
│   │   ├── application/              # Use cases and DTOs
│   │   ├── domain/                   # Domain entities and repositories
│   │   ├── infrastructure/           # AI agents, database, queue
│   │   └── presentation/              # API routes and controllers
│   ├── rust-indexer/                 # Rust native indexer
│   │   └── src/                      # Indexing and hotspot analysis
│   └── main.py                       # Backend entry point
├── src/                              # React frontend application
├── electron/                         # Electron desktop app
│   ├── main.cjs                      # Electron main process
│   └── preload.cjs                   # Preload script
├── docs/                             # Documentation
└── AGENTS.md                         # Development guidelines
```

## Configuration

Key configuration options can be set through environment variables or runtime settings:

- `APP_ENV` - Application environment (development/production)
- `APP_HOST` - API host address
- `APP_PORT` - API port (default: 9000)
- `RUST_INDEXER_ENABLED` - Enable Rust indexer
- `RUST_INDEXER_AUTO_BUILD` - Auto-build Rust indexer on startup
- `QUEUE_BACKEND` - Queue backend selection (redis/arq)

## Development

### Backend Development
```bash
cd backend
python main.py    # Start the Python API and Rust indexer
```

### Frontend Development
```bash
bun run dev              # Start Vite dev server
bun run build            # Build for production
bun run test             # Run tests
bun run lint             # Lint code
```

### Testing
- **Backend**: Python tests with pytest
- **Frontend**: Vitest for unit tests, Playwright for E2E tests

## Security Considerations

CodeGuard is designed with security as a primary concern:
- Sandboxed execution for penetration testing
- Multi-tenant isolation support
- Comprehensive input validation
- Secure credential management
- Rate limiting and throttling
- Audit logging for all operations

## License

[Specify your license here]

## Contributing

[Specify contribution guidelines here]

## Support

For issues, questions, or contributions, please refer to the project documentation or contact the development team.
