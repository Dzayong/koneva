# Per-device egress design

Status: research and future option. Current decision (2026-10-19): use private Docker bridge IPs with shared host-NAT; per-device egress and bot proxy are deferred.

## Current behavior

- The API asks Device Manager to create a device. In Docker mode, Device Manager starts one bot container and one session directory for that device.
- Bot containers share the `wa-gateway-personal` Docker bridge. They receive different private bridge addresses, but those addresses are not public Internet addresses.
- A read-only egress check from the two current bot containers returned the same public egress address. `.env.personal` has no `WA_PROXY_URL` configured.
- At the time of the initial audit, an optional `WA_PROXY_URL` was copied to each bot and attached to the Baileys socket; it did not guarantee that every outbound connection from the container used that route. This application-level bot proxy has since been removed from the current implementation.

## Goal and boundary

Provide an auditable, stable egress route for each device when a deployment has a legitimate isolation or network-routing requirement. Treat the route as a fixed network assignment, not as IP rotation or a way to avoid service enforcement. Separate egress identity from send rate, consent, message quality, and provider rules; an IP address does not make a sending pattern safe or compliant.

## Recommended architecture

Use a network-level egress gateway with a fixed provider-assigned public address per egress profile. Assign each device to one profile. Keep bot-to-Postgres/Redis traffic on the private application network, while all bot Internet-bound traffic must pass through its assigned gateway. Do not rely on Docker's private container IP as the public identity.

If a future, approved requirement calls for per-profile public egress, an application-level proxy is not sufficient to promise unique IP for all container traffic. Production acceptance must verify the network path itself. Do not silently fall back to shared host egress when such an assigned route fails; fail closed until its route recovers or an operator changes the assignment.

## Control-plane changes, in order

1. Add an egress-profile record with a stable profile ID, provider/region metadata, fixed endpoint reference, health state, and an operator-visible description. Store a device-to-profile assignment; keep tenant ownership checks on every read/write.
2. Store proxy/gateway credentials as secret-file references, not plaintext URLs in a database, logs, API responses, or Docker environment. For local Docker, mount only the device's credential file read-only into its bot. Plan a real secret manager before public multi-tenant deployment.
3. Make Device Manager provision the container with the assigned route and enforce the route at the network layer. Apply the same assignment on create, restart, reconnect, and bot refresh. Route changes must be explicit, audited, and visible to the operator.
4. Add health telemetry for route availability and observed egress identity. Redact endpoint credentials and avoid storing raw recipient/message data in these events.
5. Keep sending controls independent: consent checks, per-device rate limits, bounded retries, queue visibility, and stop-on-error/complaint behavior remain mandatory regardless of route.

## Acceptance checks before any production use

- A disposable integration test proves two synthetic devices use two distinct fixed public egress identities, while each retains the same identity across container restart.
- Network policy blocks direct Internet egress from the bot when its assigned gateway is unavailable; internal database/queue access continues only as designed.
- A deliberately unavailable gateway produces an actionable device status and does not fall back to the host's shared public address.
- Credentials do not appear in `docker inspect` environment output, logs, audit records, or dashboard/API responses.
- Create, reconnect, refresh, and delete paths all apply or remove the route without disturbing other devices' routes or session directories.
- Validate resource overhead, provider cost, and recovery behavior on a disposable host. Do not use account bans or delivery success as an acceptance metric.

## Dependencies and current decision

Implementation is not ready to enable: no egress provider, static-address allocation, secret manager, or monthly budget has been selected. First compare provider options on fixed-IP ownership, region, bandwidth/connection limits, support for long-lived WebSockets, availability, privacy terms, and cost per device. Then prototype the network-level gateway with synthetic traffic on a disposable host. Keep `:13000` and the live WhatsApp sessions on the existing shared route until that prototype and explicit owner review pass.

## Follow-up: lifecycle proof and provider shortlist (2026-10-19)

The Device Manager lifecycle is now verified end-to-end in a disposable internal Docker network: two synthetic devices were created through the actual manager HTTP route; each received a separate container and private bridge IP; the bot containers had no published ports and were forced into `KONEVA_SANDBOX=1`; reconnect restarted the same container and retained its session directory; deleting one device removed only its container/session/row while the other device stayed healthy. This validates provisioning and isolation boundaries, **not public egress identity**. The disposable network had no external route, so it deliberately made no Internet request.

Provider/architecture notes from official documentation:

- Docker's default bridge uses masquerading for external connectivity, so external services see the Docker host's address rather than each container's private bridge address. See [Docker bridge networking](https://docs.docker.com/engine/network/drivers/bridge/).
- Cloudflare Tunnel is not a per-device outbound-IP product. Cloudflare Dedicated Egress IPs are documented as a Zero Trust Enterprise add-on; traffic to private networks connected through Cloudflare Tunnel is excluded from those dedicated egress IPs. This is not a practical first MVP for this setup. See [Cloudflare Dedicated Egress IPs](https://developers.cloudflare.com/cloudflare-one/traffic-controls/egress-policies/dedicated-egress-ips/).
- Hetzner lists Cloud Floating IPv4 at €3/month (price excluding VAT). That price alone does **not** establish that a floating address can be used as a separate source-NAT identity for each container; confirm the provider's routing and source-address rules before choosing it. See [Hetzner IPv4 pricing](https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/).
- DigitalOcean documents sending a Droplet's outbound traffic over an assigned Reserved IP. This proves a stable source IP per Droplet, but per-container separation still requires host routing/SNAT or separate egress Droplets. See [DigitalOcean outbound Reserved IP](https://docs.digitalocean.com/products/networking/reserved-ips/how-to/outbound-traffic/).
- AWS public NAT Gateways bind an Elastic IP and can give private workloads a fixed outbound source address. This is technically clear but needs separate routing and cost review before using one gateway per profile. See [AWS NAT Gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html).

Recommended next implementation stage: provision **one disposable Linux VPS**, install no customer or live WhatsApp sessions, and prototype one explicitly assigned egress profile using a provider-supported fixed IP. Put the synthetic bot on a private network, route its outbound traffic through the gateway, and enforce a host firewall rule that blocks direct Internet egress. Test observed IPv4 and IPv6, DNS behavior, restart persistence, gateway failure with no shared-route fallback, and database/Redis reachability. A second distinct public IP/device test requires a second provider-backed address/profile; private Docker IPs alone cannot satisfy it. Do not turn this on for `:13000` until the provider, region, monthly cap, and test host are selected and the no-fallback acceptance check passes.

### Bounded probe on the selected existing VPS (2026-10-19)

The selected VPS is not disposable: read-only inventory found active Kangtu and RustDesk services, so the probe did not install the KONEVA stack or modify host routing/firewall policy. Instead, a temporary Docker internal network held one synthetic client; a resource-limited gateway container also joined a separate outbound bridge and allowed only `api.ipify.org:443`. Result: the client could not reach the Internet directly, its allowlisted request through the gateway observed the VPS's fixed IPv4, and stopping the gateway caused the request to fail with no direct-route fallback. The temporary containers and networks were removed; the existing services remained running.

This verifies a **single fixed egress profile** and fail-closed network shape on that host. Read-only interface inspection found one globally routable IPv4 on the VPS, so this host cannot demonstrate two distinct IPv4 egress identities with its current allocation. The probe does not verify the KONEVA bot's complete network traffic, a second distinct public IP, IPv6, reboot persistence, or production secret handling. Since this VPS hosts other services, the next full integration should run on a disposable/staging host (or an independently reserved environment) and prove those remaining checks before any KONEVA device is assigned an egress profile.

### Decision: shared Docker bridge (2026-10-19)

The production Compose baseline uses one ordinary Docker bridge (`wa-gateway-backend`) for the app services and managed bot containers. Each container has its own private bridge address; Docker NAT sends Internet-bound traffic through the host's shared public address. Postgres and Redis have no published host ports. A separate bot egress bridge, per-container public IP, and outbound proxy are not requirements for the current assignment and are not enabled by the application.

The bot still requires outbound network access to establish and maintain its WhatsApp connection. Therefore “remove egress” means remove the extra egress-routing/proxy configuration, not block outbound traffic. Nginx remains as the inbound web reverse proxy; it is unrelated to a bot's outbound proxy. The production Compose change is not deployed; validate it in staging before applying it to a production host. A provider-backed fixed egress route can be reconsidered later only if a documented requirement justifies it.
