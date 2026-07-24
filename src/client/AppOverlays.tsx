import {
  Cross2Icon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { AlertDialog, Dialog, Flex, Text } from "@radix-ui/themes";
import type { SessionInfo } from "./types";
import { Button, TextInput, TextInputSlot } from "./ui";
import { sessionTitle } from "./uiText";

type Command = { name?: string; description?: string };

export function AppOverlays({
  helpOpen,
  helpQuery,
  commands,
  shortcutHelp,
  deleteTarget,
  deletingSessionId,
  onHelpOpen,
  onHelpQuery,
  onDeleteOpen,
  onConfirmDelete,
}: {
  helpOpen: boolean;
  helpQuery: string;
  commands: Command[];
  shortcutHelp: ReadonlyArray<readonly [string, string]>;
  deleteTarget: SessionInfo | null;
  deletingSessionId: string;
  onHelpOpen: (open: boolean) => void;
  onHelpQuery: (query: string) => void;
  onDeleteOpen: (open: boolean) => void;
  onConfirmDelete: () => void;
}) {
  const normalizedQuery = helpQuery.trim().toLowerCase();
  return (
    <>
      <Dialog.Root open={helpOpen} onOpenChange={onHelpOpen}>
        <Dialog.Content className="help-modal" maxWidth="520px">
          <Flex align="center" justify="between" gap="3">
            <Dialog.Title>Keyboard shortcuts</Dialog.Title>
            <Dialog.Close>
              <Button type="button" aria-label="Close keyboard shortcuts">
                <Cross2Icon />
              </Button>
            </Dialog.Close>
          </Flex>
          <Dialog.Description>
            Search keyboard shortcuts and commands available in this session.
          </Dialog.Description>
          <TextInput
            value={helpQuery}
            onChange={(event) => onHelpQuery(event.target.value)}
            placeholder="Search shortcuts and commands"
          >
            <TextInputSlot>
              <MagnifyingGlassIcon />
            </TextInputSlot>
          </TextInput>
          <dl className="shortcut-list">
            {shortcutHelp
              .filter(
                ([keys, label]) =>
                  !normalizedQuery ||
                  `${keys} ${label}`.toLowerCase().includes(normalizedQuery),
              )
              .map(([keys, label]) => (
                <div key={keys}>
                  <dt>{keys}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            {commands
              .filter(
                (command) =>
                  normalizedQuery &&
                  String(command.name ?? "")
                    .toLowerCase()
                    .includes(normalizedQuery),
              )
              .slice(0, 8)
              .map((command) => (
                <div key={`cmd-${command.name}`}>
                  <dt>/{command.name}</dt>
                  <dd>{command.description || "Chat command"}</dd>
                </div>
              ))}
          </dl>
        </Dialog.Content>
      </Dialog.Root>

      <AlertDialog.Root
        open={Boolean(deleteTarget)}
        onOpenChange={onDeleteOpen}
      >
        <AlertDialog.Content className="delete-dialog" maxWidth="480px">
          <div className="delete-dialog-icon" aria-hidden="true">
            <TrashIcon />
          </div>
          <div>
            <Text as="div" size="1" color="gray" weight="bold">
              DELETE CHAT
            </Text>
            <AlertDialog.Title id="delete-session-title">
              {deleteTarget ? sessionTitle(deleteTarget) : "Delete chat"}
            </AlertDialog.Title>
            <AlertDialog.Description>
              This removes the chat transcript file. Workspace files stay
              untouched.
            </AlertDialog.Description>
            {deleteTarget && (
              <div className="delete-dialog-meta">
                <span>{deleteTarget.cwd}</span>
                <span>{deleteTarget.messageCount} msgs</span>
              </div>
            )}
          </div>
          <Flex className="delete-dialog-actions" justify="end" gap="2">
            <AlertDialog.Cancel>
              <Button
                type="button"
                disabled={deletingSessionId === deleteTarget?.id}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                type="button"
                className="danger"
                disabled={deletingSessionId === deleteTarget?.id}
                onClick={onConfirmDelete}
              >
                {deletingSessionId === deleteTarget?.id
                  ? "Deleting…"
                  : "Delete chat"}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
