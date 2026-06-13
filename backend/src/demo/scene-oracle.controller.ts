import { Body, Controller, Get, NotFoundException, Post, Query } from "@nestjs/common";
import { SceneOracleService, DemoDisabledError } from "./scene-oracle.service.js";

@Controller("demo/scene")
export class SceneOracleController {
  constructor(private readonly svc: SceneOracleService) {}
  private wrap<T>(p: Promise<T>): Promise<T> {
    return p.catch((e) => {
      if (e instanceof DemoDisabledError) throw new NotFoundException(e.message);
      throw e;
    });
  }
  @Post("tamper") tamper(@Body() b: { token: string; price: string }) {
    return this.wrap(this.svc.tamper(b.token, b.price));
  }
  @Get() read(@Query("token") token: string) {
    return this.wrap(this.svc.read(token));
  }
}
