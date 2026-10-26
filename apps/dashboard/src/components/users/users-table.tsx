import {
  changeUserRoleAction,
  deactivateUserAction,
  reactivateUserAction,
  resetUserPasswordAction,
} from "@/lib/users/actions";
import type { SignInMethods, UserSummary } from "@/lib/users/dto";

import { formatUtcTimestampLong } from "../logs/format";
import { Badge } from "../ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

import { UserActionDialog } from "./user-action-dialog";

/**
 * Every user, and what an administrator can do to each of them.
 *
 * A SERVER COMPONENT THAT IMPORTS THE ACTIONS and hands them to the client
 * dialogs as props — the one import site, on this side of the boundary, so
 * the action module (and the database client behind it) is compiled once.
 *
 * The buttons offered are presentation. Hiding "Deactivate" on your own row
 * stops you being offered it; the action refuses it regardless, and the
 * last-admin rule is enforced there too, inside a transaction.
 */
export function UsersTable({
  users,
  viewerId,
}: {
  users: UserSummary[];
  /** The signed-in administrator, whose own row offers no admin actions. */
  viewerId: string;
}) {
  return (
    <div className="bg-card rounded-lg border">
      <Table>
        <TableCaption className="sr-only">
          Everyone who can sign in to Stuffs Logger. All times are UTC.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Name</TableHead>
            <TableHead scope="col">Email</TableHead>
            <TableHead scope="col">Role</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Signs in with</TableHead>
            <TableHead scope="col">Created (UTC)</TableHead>
            <TableHead scope="col">Last seen (UTC)</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isViewer={user.id === viewerId}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UserRow({ user, isViewer }: { user: UserSummary; isViewer: boolean }) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          {user.name}
          {isViewer ? <Badge variant="outline">You</Badge> : null}
        </span>
      </TableCell>
      <TableCell className="text-sm break-all">{user.email}</TableCell>
      <TableCell>
        {user.role === "ADMIN" ? (
          <Badge variant="secondary">Administrator</Badge>
        ) : (
          <Badge variant="outline">Member</Badge>
        )}
      </TableCell>
      <TableCell>
        {user.isActive ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          <Badge variant="destructive">Deactivated</Badge>
        )}
      </TableCell>
      <TableCell>
        <SignInMethodBadges methods={user.signInMethods} />
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {formatUtcTimestampLong(user.createdAt)}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {user.lastSeenAt === null
          ? "Never"
          : formatUtcTimestampLong(user.lastSeenAt)}
      </TableCell>
      <TableCell>
        {isViewer ? (
          <span className="text-muted-foreground text-xs">
            Manage your own account on the Account page
          </span>
        ) : (
          <UserRowActions user={user} />
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * The ways a user can sign in, as badges. "None" is shown loudly: an account
 * with no credential at all cannot sign in by any route.
 */
function SignInMethodBadges({ methods }: { methods: SignInMethods }) {
  const labels = [
    ...(methods.password ? ["Password"] : []),
    ...(methods.google ? ["Google"] : []),
    ...methods.other,
  ];

  if (labels.length === 0) return <Badge variant="warning">None</Badge>;

  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="outline">
          {label}
        </Badge>
      ))}
    </span>
  );
}

function UserRowActions({ user }: { user: UserSummary }) {
  const nextRole = user.role === "ADMIN" ? "MEMBER" : "ADMIN";
  const hasPassword = user.signInMethods.password;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <UserActionDialog
        action={changeUserRoleAction}
        userId={user.id}
        userEmail={user.email}
        hiddenFields={{ role: nextRole }}
        triggerLabel={
          nextRole === "ADMIN" ? "Make administrator" : "Make member"
        }
        title={
          nextRole === "ADMIN"
            ? `Make ${user.name} an administrator?`
            : `Make ${user.name} a member?`
        }
        description={
          nextRole === "ADMIN"
            ? "Administrators manage applications, ingest keys, API tokens and every user — including other administrators."
            : "They keep reading every application's logs, but lose access to applications, keys, tokens and users from their next request."
        }
        submitLabel={
          nextRole === "ADMIN" ? "Make administrator" : "Make member"
        }
        pendingLabel="Saving…"
      />

      {user.isActive ? (
        <UserActionDialog
          action={deactivateUserAction}
          userId={user.id}
          userEmail={user.email}
          requireEmailConfirmation
          destructive
          triggerLabel="Deactivate"
          title={`Deactivate ${user.name}?`}
          description="They are signed out everywhere and refused on their next request. Nothing is deleted, and you can reactivate them later."
          submitLabel="Deactivate"
          pendingLabel="Deactivating…"
        />
      ) : (
        <UserActionDialog
          action={reactivateUserAction}
          userId={user.id}
          userEmail={user.email}
          triggerLabel="Reactivate"
          title={`Reactivate ${user.name}?`}
          description="They can sign in again with their existing password or Google account, with the role shown in this table."
          submitLabel="Reactivate"
          pendingLabel="Reactivating…"
        />
      )}

      <UserActionDialog
        action={resetUserPasswordAction}
        userId={user.id}
        userEmail={user.email}
        requireEmailConfirmation
        destructive={hasPassword}
        triggerLabel={hasPassword ? "Reset password" : "Add a password"}
        title={
          hasPassword
            ? `Reset ${user.name}'s password?`
            : `Add a password for ${user.name}?`
        }
        description={
          hasPassword
            ? "Their current password stops working, they are signed out everywhere, and you are shown a new temporary password once."
            : "They sign in with Google and have no password. This adds one alongside Google, signs them out everywhere, and shows you a temporary password once."
        }
        submitLabel={hasPassword ? "Reset password" : "Add password"}
        pendingLabel="Issuing…"
      />
    </div>
  );
}
