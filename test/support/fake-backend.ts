import type { BackendFile, BackendGateway, BackendRequest } from "../../src/application/ports.js";

export interface RecordedCall {
  readonly request: BackendRequest;
}

export interface FakeBackend extends BackendGateway {
  readonly calls: RecordedCall[];
}

export function fakeBackend(
  handler: (request: BackendRequest) => unknown,
): FakeBackend {
  const calls: RecordedCall[] = [];

  return {
    calls,
    async send<Result>(request: BackendRequest) {
      calls.push({ request });
      return handler(request) as Result;
    },
    async download(request: BackendRequest): Promise<BackendFile> {
      calls.push({ request });
      return handler(request) as BackendFile;
    },
  };
}

export const anOrder = {
  id: "0199a1b2-c3d4-7000-8000-000000000001",
  deliveryDate: "2026-09-01T00:00:00Z",
  status: "Received",
  clientId: "0199a1b2-c3d4-7000-8000-000000000002",
  clientName: "Ada",
  clientMobile: null,
  totalPaid: 12000,
  totalValue: 12000,
  references: null,
  items: [
    {
      productId: "0199a1b2-c3d4-7000-8000-000000000003",
      productName: "Bolo",
      productSize: "M",
      observation: null,
      massa: null,
      sabor: null,
      quantity: 1,
      paidUnitPrice: 12000,
      baseUnitPrice: 12000,
      itemCanceled: false,
      totalPaid: 12000,
      totalValue: 12000,
    },
  ],
  paidAt: null,
  paidByUserName: null,
};
