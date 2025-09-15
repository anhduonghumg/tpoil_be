import { Injectable } from "@nestjs/common";
import { PassportSerializer } from "@nestjs/passport";
import { AuthService } from "./auth.service";

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private auth: AuthService) {
    super();
  }

  serializeUser(user: any, done: Function) {
    done(null, user.id);
  }

  async deserializeUser(userId: string, done: Function) {
    try {
      const user = await this.auth.findUserById(userId);
      done(null, user || null);
    } catch {
      done(null, null);
    }
  }
}
