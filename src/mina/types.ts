import { Mina } from "o1js";

export type MinaApi = Awaited<ReturnType<typeof Mina.Network>>;
