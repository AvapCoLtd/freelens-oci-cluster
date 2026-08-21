# freelens-oci-cluster

![License](https://img.shields.io/github/license/AvapCoLtd/freelens-oci-cluster)
![Release](https://img.shields.io/github/v/release/AvapCoLtd/freelens-oci-cluster)

See the OCI resources backing your open cluster, right in FreeLens.

![Network page showing a CRITICAL backend health status for an LB/NLB](docs/images/network-lb-critical.png)

[日本語](README.md)

The extension visualizes relationships between Kubernetes and Oracle Cloud Infrastructure (OCI) resources that FreeLens does not show by default.

- Node → Instance
- Service (type=LoadBalancer) → NLB / classic LB
- PersistentVolume → Block Volume / FSS

Starting from each Node's `providerID`, it automatically resolves OCI resources related to the open cluster.
It never performs operations that mutate OCI resources.

## Prerequisites

FreeLens 1.8.0 or later and an authenticated `oci` CLI are required.
The extension is verified on FreeLens 1.10.3 (Extension API 1.10.3, Windows x64).

The extension spawns `oci` for each data fetch and reads its JSON output.
It never receives keys or tokens; authentication remains entirely inside `oci`.
You can also configure a wrapper command or an `oci` installation running under WSL.

## Install

1. Download the latest `.tgz` from [GitHub Releases](https://github.com/AvapCoLtd/freelens-oci-cluster/releases).
2. Drag and drop it onto the Extensions screen in FreeLens.
3. Repeat the same operation with a new `.tgz` when updating.

## Usage

Connect to a cluster in FreeLens and open the "OCI" menu in the cluster sidebar.
The following pages are available for OKE clusters.
For non-OKE clusters, the extension displays an out-of-scope message.

| Page | Contents |
|---|---|
| Nodes | K8s Node to OCI Instance mappings and a node pool summary |
| Service↔LB | LoadBalancer Service to NLB / classic LB mappings |
| PV ↔ Storage | PersistentVolume to Block Volume / FSS mappings and backup policies |
| Network | DNS (with a console link to the matching OCI DNS zone), WAF, LB/NLB, subnet, route, and backend health checks in outside-in path order |
| Topology | A diagram of cluster-related resources and their connections |

The search bar on each page filters displayed content, including expandable details.
A header toggle enables auto-refresh; its interval is configurable in Preferences (60 seconds by default).

## Settings

Set the command to run in the "OCI: oci command" field in FreeLens Preferences.

- A blank value uses the `oci` found on `PATH`.
- Leading arguments are allowed, such as `oci --profile foo`.
- Wrapper commands such as `wsl oci` are supported.
- The value is split on whitespace; quotes are not interpreted.

Changes take effect on the next data fetch.
See [OCI command integration](docs/oci-command.en.md) for the compatible-command output, timeout, and paging contract.

## Documentation

| Task | Reference |
|---|---|
| Set up development, run tests, or release | [Contributing](CONTRIBUTING.en.md) |
| Understand resource mapping and design rationale | [Design decisions](docs/design.md) |
| Implement an `oci` wrapper or compatible command | [OCI command integration](docs/oci-command.en.md) |
| Review findings about the FreeLens Extension API | [FreeLens Extension API sources](docs/extension-api.md) |

## Repositories

- [GitHub (public and releases)](https://github.com/AvapCoLtd/freelens-oci-cluster)
- [GitLab (development)](https://gitlab.avaper.day/avap/freelens-plugins/freelens-oci-cluster)

## License

MIT
