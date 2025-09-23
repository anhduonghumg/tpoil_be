import { SetMetadata } from "@nestjs/common";

export const MODULE_KEY = "audit:module";
export const ModuleName = (moduleCode: string) => SetMetadata(MODULE_KEY, moduleCode);
