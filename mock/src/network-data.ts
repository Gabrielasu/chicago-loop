/** The network exported by the pipeline (python -m pipeline.export_network). */

import data from "../data/network.json" with { type: "json" };
import type { Network } from "./types.ts";

export const network = data as unknown as Network;
