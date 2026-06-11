import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { DemoSeries } from "@meridian/sdk";
import { DemoService } from "../demo/demo.service.js";

@ApiTags("demo")
@Controller("demo")
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get()
  @ApiOperation({ summary: "List demo series" })
  list(): DemoSeries[] {
    return this.demo.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a static V0 demo series" })
  @ApiParam({ name: "id" })
  get(@Param("id") id: string): DemoSeries {
    return this.demo.get(id);
  }
}
