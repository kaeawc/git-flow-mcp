# git flow MCP server

The goal of the project is to provide git workflow capabilities through MCP tool calls to drive decentralized source 
code navigation and iteration. A software engineer should be able to provide an environment with git global config that
uses credentials in ~/.ssh, github or gitlab CLI tools, and basic information about a ticket or branch to let an AI agent
create or checkout a branch, add work, commit it, push the branch, create a GitHub PR or GitLab MR, observe comment or commit
status feedback, address the feedback, and work to get the change approved and merged.

### Platform Support

- **GitHub** - Full integration with GitHub CLI (`gh`)
- **GitLab** - Complete GitLab support via GitLab CLI (`glab`)
- **JIRA** - Issue tracking via JIRA CLI (`jira`)

## Tool Calla

- **Branch Management** (`prepare-branch`) - Create, checkout, and sync branches with intelligent handling
- **Work Synchronization** (`sync-work`) - Advanced branch syncing with conflict resolution strategies
- **PR/MR Management** (`manage-pr`) - Complete pull request lifecycle across GitHub and GitLab
- **Issue Tracking Integration** (`track-issues`) - Connect with JIRA, GitHub Issues, GitLab Issues
- **Status Monitoring** (`monitor-status`) - Monitor PR/MR status, CI/CD pipelines, and feedback
- **Workflow Orchestration** (`orchestrate-workflow`) - High-level automation for common development patterns
- **Advanced Conflict Resolution** (`resolve-conflicts`) - Intelligent merge conflict resolution with multiple
  strategies

## Prompt Examples:

> Work on JIRA-1234

Should observe whether we need to create or checkout a branch with the JIRA issue number, work on the described task,
commit changes, push the branch to the origin remote, check whether a remote PR or MR needs to be created, and then
create or update the remote PR or MR.

> Check my PRs for feedback

Should check open GitHub PRs for unresolved feedback. This could be in the form of unresolved comment threads or commit
statuses. Only choose one PR and branch to pull and work and commit changes on at a time.

> Complete my current feature

Should sync the current branch with the base branch, run tests, push changes, and create a PR with appropriate reviewers
and labels.

> Resolve merge conflicts intelligently

Should analyze current conflicts, apply smart resolution strategies where possible, and provide guided assistance for
complex conflicts.

## Documentation

- 💻 [Installation & Getting Started](docs/installation.md)
- 📋 [Phase 2 Implementation Summary](docs/phase2-summary.md)
- 📝 [Change Log](CHANGELOG.md) - coming soon

## Contributing

- [Contributing](.github/CONTRIBUTING.md) - coming soon
