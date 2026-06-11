import { Injectable, NotFoundException } from "@nestjs/common";
import type { DemoSeries } from "@meridian/sdk";
import { DEMO_SERIES } from "./demo.series.js";

@Injectable()
export class DemoService {
  private readonly byId = new Map<string, DemoSeries>(DEMO_SERIES.map((s) => [s.id, s]));

  list(): DemoSeries[] {
    return [...this.byId.values()];
  }

  get(id: string): DemoSeries {
    const s = this.byId.get(id);
    if (!s) throw new NotFoundException(`demo series ${id} not found`);
    return s;
  }
}
