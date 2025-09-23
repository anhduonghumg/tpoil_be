import { RbacService } from "./rbac.service";
import { RbacController } from "./rbac.controller";
/*
https://docs.nestjs.com/modules
*/

import { Module } from "@nestjs/common";

@Module({
  imports: [],
  controllers: [RbacController],
  providers: [RbacService],
})
export class RbacModule {}
