import type { GlobalRole, ProjectRole } from '@ibutest/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware for interactive (JWT) sessions. */
      auth?: {
        userId: string;
        sessionId: string;
        email: string;
        name: string;
        role: GlobalRole;
        mfaEnabled: boolean;
        mustChangePassword: boolean;
      };
      /** Set by `loadProject`: the project plus the caller's effective role in it. */
      project?: {
        id: string;
        key: string;
        name: string;
        isArchived: boolean;
        aiEnabled: boolean;
        role: ProjectRole;
      };
      /** Set by `authenticateApiToken` for automation integrations. */
      apiToken?: {
        tokenId: string;
        userId: string;
        projectId: string;
      };
    }
  }
}

export {};
