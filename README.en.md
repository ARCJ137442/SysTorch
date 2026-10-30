# SysTorch

[简体中文](README.md) · [Website](https://arcj137442.github.io/SysTorch/) · [Releases and downloads](https://github.com/ARCJ137442/SysTorch/releases) · [Documentation index](docs/README.md)

<p align="center">
  <img src="ui/src/brand/systorch.svg" width="112" alt="SysTorch torch mark">
</p>

> **Turn questions into next steps.**
>
> 把眼前的问题，变成下一步。

SysTorch is a **structured decision runtime for people, models, and agents**. It sends a decision request through an inspectable DAG, routes it among compatible decision services, and can persist a task for a human to answer before returning a strictly mapped result to the original caller.

![SysTorch 0.12.0 Start preview with a synthetic successful decision and route trace](docs/gallery/images/start-desktop.png)

> The gallery uses synthetic local previews; these are not screenshots of the 0.12.0 EXE or APK. See the [gallery notes](docs/gallery/README.md) for evidence boundaries.

<p align="center">
  <a href="docs/gallery/README.md">View the product gallery · 浏览截图图册</a>
</p>

## Why SysTorch

A conventional model API tells you which service received a request. SysTorch also shows the path: which route was selected, which attempts ran, whether a human took over, and how the result returned to the caller.

A typical flow:

1. An agent, harness, or person submits one or more structured questions with stable IDs.
2. SysTorch selects local or cloud decision services through a DAG; route glow reflects actual request and response events.
3. When a task needs human judgment, the decision desk persists it. The caller can exit and retrieve the result later.
4. Successful replies, failed attempts, retries, and route traces stay tied to the same conversation for review.

Core workflows do not require OpenAI, Anthropic, or another general text-generation API. When a remote decision service is configured, requests are sent to that upstream; local mode does not mean offline.

## Capabilities

- **Start**: a standard chat-style entry for Noul, Choice, Score, and Box questions; supports multi-question messages, shared context, and attachments.
- **Durable human decisions**: submit, exit the caller, answer in the decision desk, then retrieve with the same caller identity; supports authorization, idempotency, expiry, atomic multi-question answers, and restart recovery.
- **Editable DAG**: organizes public entries, reusable routing nodes, and provider exits. Each edge reflects actual request events. Graph edits use atomic operations and invalid updates roll back.
- **Local service lifecycle**: providers can define start, stop, status probes, and process policy; the host-command gate is off by default.
- **Attachments and media**: images, audio, video, and ordinary files share one asset model. The UI does not block files based on the selected provider; adapters return an explicit format/capability error when lossless conversion is unavailable. Official TypeSafe image projection is limited to PNG/JPEG; other media requires an explicitly compatible target.
- **Traceable history**: entry view aggregates parent requests, while provider view lists actual upstream attempts. Request bodies, answers, and credentials are kept out of ordinary route history.
- **Agent API and CLI**: human actions and caller requests use the same authorization and persistence boundaries.

Built-in upstream adapters are Vercel, Laya, TypeSafe SystemOne, and OpenRouter. OpenRouter is an upstream translation adapter, not an OpenAI/Anthropic chat-compatible gateway. Public model calls use the Jev/SystemOne decision protocol; SysTorch is the product name and is not bound to one model or provider.

## Pre-release · v0.12.0

v0.12.0 is a SysTorch pre-release that consolidates the canonical SysTorch API, structured route traces, and the way Start / Decision Desk exposes call history. It targets Windows x64 and Android arm64 and **has not been accepted hands-on by the maintainer**.

- Windows ships a single-file Standalone EXE. No Authenticode certificate is configured, so Windows may show an unknown publisher warning.
- Android ships an arm64 APK signed with the stable Android key. The installed application identity stays unchanged for in-place upgrades and access to existing task data; the displayed app name and product brand are SysTorch.
- Physical Android camera/gallery selection, permission-denial paths, and background lifecycle still need maintainer device verification.
- This pre-release does not claim every provider supports every question or media type.

[Download the v0.12.0 pre-release](https://github.com/ARCJ137442/SysTorch/releases/tag/v0.12.0)

## Quick start

### Windows / Android

Download the corresponding asset from the [GitHub Release](https://github.com/ARCJ137442/SysTorch/releases). Android can update an installed stable build. If Android reports a signature mismatch, stop and contact the maintainer; do not uninstall first, which could erase private app data.

### Run from source

Requirements: Rust stable, Node.js 20, and npm.

~~~powershell
$env:SYSTORCH_CONFIG = "rs\providers.example.toml"
cargo run --manifest-path rs/Cargo.toml
~~~

In another terminal, start the frontend development server:

~~~powershell
npm ci --prefix ui
npm run dev --prefix ui
~~~

When SYSTORCH_CONFIG is set, the daemon uses that config. Older variables such as JEV_SWITCH_CONFIG remain compatibility aliases; use SYSTORCH_* names for new deployments.

### Agents and callers

The [external Choice guide](docs/guides/SYSTORCH-EXTERNAL-CHOICE.md) shows where to configure a caller token and how to submit, exit, answer, and retrieve a task. HTTP request shapes and errors are indexed in the [contract directory](docs/contracts/00-INDEX.md).

## Architecture and security

The Rust daemon owns upstream credentials, the DAG, SQLite, events, and encrypted SysTorch sessions. The React UI uses the local or remote gateway API; Tauri provides Windows and Android shells. Display branding is SysTorch. Existing data directories, installed identities, owner keys, historical protocols, and old environment variables remain compatibility anchors.

Every model request is sent to its selected upstream. Provider API keys stay in the daemon. Ordinary chats and human tasks use the SysTorch owner key for encrypted payloads; route history stores safe metadata and provider attempts only. A database backup must include its matching owner key to decrypt existing conversations.

## Development and verification

~~~powershell
cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline
cargo test --manifest-path rs/Cargo.toml --workspace --features ts-rs --locked --offline
cargo clippy --manifest-path rs/Cargo.toml --workspace --all-targets --locked --offline
npm test --prefix ui
npm run lint --prefix ui
npm run build --prefix ui
~~~

See the [release guide](docs/RELEASE.md) and [roadmap](ROADMAP.md). Older Jev Switch screenshots, tags, and incident records remain historical evidence; they do not describe the current SysTorch 0.12.0 state.
