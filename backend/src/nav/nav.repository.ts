import { Injectable } from "@nestjs/common";
import { type NavResult, navResultToSnapshotInput } from "../domain/oracle.js";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class NavRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Persist a computed NavResult as a NavSnapshot row; returns the snapshot id. */
  async saveSnapshot(vaultAddress: string, result: NavResult): Promise<string> {
    const row = await this.prisma.navSnapshot.create({
      data: navResultToSnapshotInput(vaultAddress, result),
    });
    return row.id;
  }

  async latest(vaultAddress: string) {
    return this.prisma.navSnapshot.findFirst({
      where: { vaultAddress },
      orderBy: { timestamp: "desc" },
    });
  }
}
