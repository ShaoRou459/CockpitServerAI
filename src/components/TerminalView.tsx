/*
 * TerminalView - Wrapper around XTerminal with header controls
 */

import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import {
    Card,
    CardHeader,
    CardBody,
    CardTitle,
    Button,
    Flex,
    FlexItem,
} from "@patternfly/react-core";
import { TrashIcon } from "@patternfly/react-icons";
import cockpit from 'cockpit';

import { XTerminal, XTerminalHandle } from './XTerminal';

const _ = cockpit.gettext;

// Handle exposed to parent
export interface TerminalViewHandle {
    executeCommand: (command: string) => Promise<{ output: string; exitCode: number; cwd: string }>;
    clear: () => void;
    getVisibleText: () => string;
}

interface TerminalViewProps {
    onReady?: (() => void) | undefined;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(({ onReady }, ref) => {
    const terminalRef = useRef<XTerminalHandle>(null);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        executeCommand: async (command: string) => {
            if (terminalRef.current) {
                return terminalRef.current.executeCommand(command);
            }
            return { output: 'Terminal not ready', exitCode: -1, cwd: '' };
        },
        clear: () => {
            if (terminalRef.current) {
                terminalRef.current.clear();
            }
        },
        getVisibleText: () => {
            if (terminalRef.current) {
                return terminalRef.current.getVisibleText();
            }
            return '';
        }
    }));

    const handleClear = () => {
        if (terminalRef.current) {
            terminalRef.current.clear();
        }
    };

    return (
        <Card className="terminal-card">
            <CardHeader>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                        <CardTitle>
                            <span className="terminal-header-icon">⬛</span>
                            {_("Terminal")}
                        </CardTitle>
                    </FlexItem>
                    <FlexItem>
                        <Button
                            variant="plain"
                            aria-label="Clear terminal"
                            onClick={handleClear}
                            className="terminal-clear-btn"
                        >
                            <TrashIcon />
                        </Button>
                    </FlexItem>
                </Flex>
            </CardHeader>
            <CardBody className="terminal-body">
                <XTerminal ref={terminalRef} onReady={onReady} />
            </CardBody>
        </Card>
    );
});

TerminalView.displayName = 'TerminalView';
