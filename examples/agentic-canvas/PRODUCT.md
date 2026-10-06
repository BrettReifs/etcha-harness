# Agentic canvas

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript and Vite, with a bounded DOM/SVG canvas. The issue delegates selection
of a suitable browser stack. This example owns its package and lockfile.

## Users and purpose

The requested first milestone is a single-user canvas for typed notes, retained
handwriting strokes, and recorded audio notes. Replies and action proposals belong
beside objects, not in a chat sidebar.

## Operating context

The offline demo must work without credentials. Optional live intelligence uses
Jev structured judgments and GitHub Copilot SDK orchestration on a local server.
The user submits notes, completes strokes, or submits a transcript. Each action
is bounded; generated objects must not trigger another agent request.

## Capabilities and constraints

Support selection, movement, pan, zoom, local persistence, undo, and reversible
animation. Save workflow definitions only with explicit approval. Workflow reuse
is not model training. Prediction must not grant permission.

Retain strokes when transcription is unavailable. Do not fabricate recognition
or transcripts. Detailed image generation is optional, provider-owned, and
confirmation-gated. No mandatory services, telemetry, deployment, or root setup
changes. Credentials never belong in browser code.

## Evidence and open decisions

The issue supplies the hero flow and acceptance criteria. No approved visual
baseline, user research, or live credentials are available. Production identity,
broader editing features, collaboration, and deployment remain undecided.

## Accessibility

Keyboard access, visible focus, plain English, responsive controls, loading and
error feedback, and reduced motion are required. Automated checks do not replace
human review or assistive-technology testing.
