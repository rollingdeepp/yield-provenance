# Yield Provenance

Secure yield attribution with transparent source tracking on GenLayer.

- **App**: https://rollingdeepp.github.io/yield-provenance/
- **Network**: GenLayer Studionet

## Overview

A decentralized system for tracking and verifying yield sources in DeFi protocols. The contract maintains transparent records of yield origins, validates attribution claims, and provides auditable provenance trails for all yield-generating activities.

## Features

- Transparent yield source tracking
- Auditable provenance trails
- Automated validation of yield claims
- On-chain verification of yield origins
- Multi-protocol yield attribution

## Structure

- `backend/` - GenLayer smart contract (yield-provenance.py)
- `frontend/` - React + TypeScript + Vite web application

## Develop

```bash
cd frontend
npm install
npm run dev      # http://localhost:5380
```

## Build

```bash
cd frontend
npm run build    # static output in dist/
```

## Deploy

This project is automatically deployed to GitHub Pages via GitHub Actions on every push to main.
