/*
 * TerminalView - Simple styled terminal output display
 * 
 * Since xterm.js relies on inline styles that CSP blocks,
 * we use a simple pre-formatted text display with custom styling.
 */

import React, { useEffect, useRef } from 'react';
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

const _ = cockpit.gettext;

interface TerminalViewProps {
    output: string;
    onClear: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
    output,
    onClear
}) => {
    const terminalRef = useRef<HTMLPreElement>(null);

    // Auto-scroll to bottom when output changes
    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [output]);

    // Parse and colorize output
    const renderOutput = () => {
        if (!output) {
            return (
                <div className="terminal-welcome">
                    <div className="terminal-logo">🤖</div>
                    <div className="terminal-title">AI Agent Terminal</div>
                    <div className="terminal-subtitle">Command output will appear here</div>
                </div>
            );
        }

        // Simple colorization based on content
        const lines = output.split('\n');
        return lines.map((line, i) => {
            let className = 'terminal-line';

            // Color commands (lines starting with $)
            if (line.startsWith('$ ')) {
                className += ' terminal-command';
            }
            // Color success indicators
            else if (line.includes('✓') || line.includes('SUCCESS') || line.includes('success')) {
                className += ' terminal-success';
            }
            // Color error indicators
            else if (line.includes('✗') || line.includes('ERROR') || line.includes('error') || line.includes('Error')) {
                className += ' terminal-error';
            }
            // Color warnings
            else if (line.includes('⚠') || line.includes('WARNING') || line.includes('warning')) {
                className += ' terminal-warning';
            }
            // Color info/status lines
            else if (line.startsWith('📄') || line.startsWith('📝') || line.startsWith('🔧')) {
                className += ' terminal-info';
            }
            // Blocked/denied
            else if (line.includes('⛔') || line.includes('❌') || line.includes('Denied') || line.includes('Blocked')) {
                className += ' terminal-blocked';
            }

            return (
                <div key={i} className={className}>
                    {line || '\u00A0'}
                </div>
            );
        });
    };

    return (
        <Card className="terminal-card">
            <CardHeader>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                        <CardTitle>
                            <span className="terminal-header-icon">⬛</span>
                            {_("Terminal Output")}
                        </CardTitle>
                    </FlexItem>
                    <FlexItem>
                        <Button
                            variant="plain"
                            aria-label="Clear terminal"
                            onClick={onClear}
                            className="terminal-clear-btn"
                        >
                            <TrashIcon />
                        </Button>
                    </FlexItem>
                </Flex>
            </CardHeader>
            <CardBody className="terminal-body">
                <pre ref={terminalRef} className="terminal-output">
                    {renderOutput()}
                </pre>
            </CardBody>
        </Card>
    );
};
