import {
  changeOwnPasswordAction,
  revokeOtherSessionsAction,
} from "@/lib/users/account-actions";
import type { OwnAccount } from "@/lib/users/dto";

import { Badge } from "../ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

import { ChangePasswordForm } from "./change-password-form";
import { RevokeOtherSessionsForm } from "./revoke-other-sessions-form";

/**
 * The `/account` page body: who you are, your password, your sessions.
 *
 * A server component, and the ONE place the account actions are imported;
 * they reach the client forms as props.
 */
export function AccountSections({ account }: { account: OwnAccount }) {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Profile</h2>
          </CardTitle>
          <CardDescription>
            Your name and address are managed by an administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{account.name.trim().length > 0 ? account.name : "—"}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{account.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>
              <Badge variant="outline">
                {account.role === "ADMIN" ? "Administrator" : "Member"}
              </Badge>
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Password</h2>
          </CardTitle>
          <CardDescription>
            {account.signInMethods.password
              ? "Changing your password signs you out everywhere else."
              : null}
            {!account.signInMethods.password && account.signInMethods.google
              ? "You sign in with Google, so you have no password here. Ask an administrator if you need one."
              : null}
            {!account.signInMethods.password && !account.signInMethods.google
              ? "This account has no password. Ask an administrator to add one."
              : null}
          </CardDescription>
        </CardHeader>
        {account.signInMethods.password ? (
          <CardContent>
            <ChangePasswordForm action={changeOwnPasswordAction} />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Sessions</h2>
          </CardTitle>
          <CardDescription>
            Signed in on a shared or lost device? Sign out everywhere except
            this browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RevokeOtherSessionsForm action={revokeOtherSessionsAction} />
        </CardContent>
      </Card>
    </div>
  );
}
