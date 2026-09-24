# Deploying on Porto

App: `bridge/mainnet/liquidity-bridge-rebalancer`. One pod runs both the cron server (port 3000) and the core API (port 3001) via `entrypoint.sh`; they share the SQLite file on a 1Gi PVC mounted at `/app/data` (`DB_PATH`). Porto creates the PVC on first deploy. Rollouts use `recreate`, so expect a few seconds of downtime per deploy.

No ingress. Other apps in the cluster reach it at:

- API: `http://bridge-mainnet-liquidity-bridge-rebalancer.default.svc.cluster.local:3001`
- Cron: `http://bridge-mainnet-liquidity-bridge-rebalancer-cron.default.svc.cluster.local:3000`

## First-time setup

1. Create the SSM parameters (SecureString, eu-west-1) listed under `[secrets]` in `porto.toml`.
2. Register the app and point Porto at this folder:

   ```sh
   ssh porto "apps:create bridge/mainnet/liquidity-bridge-rebalancer"
   ssh porto "apps:set-config bridge/mainnet/liquidity-bridge-rebalancer deploy/porto.toml"
   ssh porto "apps:set-github bridge/mainnet/liquidity-bridge-rebalancer availproject/liquidity-bridge-rebalancer"
   ```

3. Remove the default hostname before the first deploy so the ingress is never created:

   ```sh
   ssh porto "domains:remove bridge/mainnet/liquidity-bridge-rebalancer liquidity-bridge-rebalancer-mainnet.bridge.avail.tools"
   ```

4. Deploy:

   ```sh
   ssh porto "apps:deploy bridge/mainnet/liquidity-bridge-rebalancer main"
   ```

## Day to day

```sh
ssh porto "apps:deploy bridge/mainnet/liquidity-bridge-rebalancer <sha>"
ssh porto "logs bridge/mainnet/liquidity-bridge-rebalancer --tail"
ssh porto "apps:info bridge/mainnet/liquidity-bridge-rebalancer"
```

Config changes go in `porto.toml` and ship with the next deploy.
