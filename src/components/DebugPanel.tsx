/*
 * DebugPanel - Floating debug panel that displays all application logs
 * 
 * Features:
 * - Draggable/resizable floating panel
 * - Filter by log level and category
 * - Expandable log entries with full data
 * - Export functionality
 * - Live updates via subscription
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Button,
    Flex,
    FlexItem,
    Badge,
    Select,
    SelectOption,
    MenuToggle,
    MenuToggleElement,
} from "@patternfly/react-core";
import {
    BugIcon,
    TimesIcon,
    TrashIcon,
    DownloadIcon,
    AngleRightIcon,
    AngleDownIcon,
    CompressIcon,
    ExpandIcon,
    PauseIcon,
    PlayIcon,
} from "@patternfly/react-icons";
import { debugLogger, LogEntry, LogLevel, LogCategory } from '../lib/debug-logger';

interface DebugPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

// Category display names and colors
const CATEGORY_CONFIG: Record<LogCategory, { label: string; color: string }> = {
    'api-request': { label: 'API →', color: '#0066cc' },
    'api-response': { label: 'API ←', color: '#3e8635' },
    'ai-parse': { label: 'Parse', color: '#8a4fff' },
    'action': { label: 'Action', color: '#f0ab00' },
    'command': { label: 'CMD', color: '#73bcf7' },
    'settings': { label: 'Settings', color: '#6a6e73' },
    'state': { label: 'State', color: '#8a8d90' },
    'secret': { label: 'Secret', color: '#ec7a08' },
    'error': { label: 'Error', color: '#c9190b' },
    'system': { label: 'System', color: '#6a6e73' },
};

const LEVEL_CONFIG: Record<LogLevel, { color: string; bg: string }> = {
    'debug': { color: '#6a6e73', bg: 'transparent' },
    'info': { color: '#0066cc', bg: 'transparent' },
    'warn': { color: '#f0ab00', bg: '#f0ab0015' },
    'error': { color: '#c9190b', bg: '#c9190b15' },
};

export const DebugPanel: React.FC<DebugPanelProps> = ({ isOpen, onClose }) => {
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
    const [filterCategory, setFilterCategory] = useState<LogCategory | 'all'>('all');
    const [isMinimized, setIsMinimized] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [levelSelectOpen, setLevelSelectOpen] = useState(false);
    const [categorySelectOpen, setCategorySelectOpen] = useState(false);

    const logsEndRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Dragging state
    const [position, setPosition] = useState<{ x: number | null, y: number | null }>({ x: null, y: null });
    const dragStart = useRef<{ x: number, y: number } | null>(null);

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.debug-panel__header')) return;
        if (target.closest('.debug-panel__btn')) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        dragStart.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        target.setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStart.current) return;
        setPosition({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        });
    }, []);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        dragStart.current = null;
        const target = e.target as HTMLElement;
        if (target.hasPointerCapture(e.pointerId)) {
            target.releasePointerCapture(e.pointerId);
        }
    }, []);

    // Subscribe to log updates
    useEffect(() => {
        // Load existing entries
        setEntries(debugLogger.getEntries());

        // Subscribe to new entries
        const unsubscribe = debugLogger.subscribe((entry) => {
            if (!isPaused) {
                setEntries(prev => [...prev, entry]);
            }
        });

        return unsubscribe;
    }, [isPaused]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (!isPaused && !isMinimized) {
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [entries, isPaused, isMinimized]);

    // Filter entries
    const filteredEntries = entries.filter(entry => {
        if (filterLevel !== 'all' && entry.level !== filterLevel) return false;
        if (filterCategory !== 'all' && entry.category !== filterCategory) return false;
        return true;
    });

    const toggleExpand = useCallback((id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleClear = () => {
        debugLogger.clear();
        setEntries([]);
    };

    const handleExport = () => {
        const json = debugLogger.exportLogs();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debug-log-${new Date().toISOString()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    const style: React.CSSProperties = {};
    if (position.x !== null && position.y !== null) {
        style.left = `${position.x}px`;
        style.top = `${position.y}px`;
        style.right = 'auto';
        style.bottom = 'auto';
        style.transform = 'none';
        style.margin = 0;
    }

    return (
        <div 
            className="debug-panel" 
            ref={containerRef}
            style={style}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            {/* Header */}
            <div className="debug-panel__header" style={{ cursor: 'grab' }}>
                <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                    <FlexItem>
                        <BugIcon className="debug-panel__icon" />
                    </FlexItem>
                    <FlexItem>
                        <span className="debug-panel__title">Debug Console</span>
                    </FlexItem>
                    <FlexItem>
                        <Badge className="debug-panel__count">{filteredEntries.length}</Badge>
                    </FlexItem>
                </Flex>
                <Flex spaceItems={{ default: 'spaceItemsXs' }}>
                    <FlexItem>
                        <Button
                            variant="plain"
                            size="sm"
                            onClick={() => setIsPaused(!isPaused)}
                            title={isPaused ? 'Resume' : 'Pause'}
                            className="debug-panel__btn"
                        >
                            {isPaused ? <PlayIcon /> : <PauseIcon />}
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button
                            variant="plain"
                            size="sm"
                            onClick={handleExport}
                            title="Export Logs"
                            className="debug-panel__btn"
                        >
                            <DownloadIcon />
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button
                            variant="plain"
                            size="sm"
                            onClick={handleClear}
                            title="Clear Logs"
                            className="debug-panel__btn debug-panel__btn--danger"
                        >
                            <TrashIcon />
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button
                            variant="plain"
                            size="sm"
                            onClick={() => setIsMinimized(!isMinimized)}
                            title={isMinimized ? 'Expand' : 'Minimize'}
                            className="debug-panel__btn"
                        >
                            {isMinimized ? <ExpandIcon /> : <CompressIcon />}
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button
                            variant="plain"
                            size="sm"
                            onClick={onClose}
                            title="Close"
                            className="debug-panel__btn"
                        >
                            <TimesIcon />
                        </Button>
                    </FlexItem>
                </Flex>
            </div>

            {/* Filters */}
            {!isMinimized && (
                <div className="debug-panel__filters">
                    <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem>
                            <Select
                                isOpen={levelSelectOpen}
                                onOpenChange={setLevelSelectOpen}
                                selected={filterLevel}
                                onSelect={(_e, value) => {
                                    setFilterLevel(value as LogLevel | 'all');
                                    setLevelSelectOpen(false);
                                }}
                                toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                                    <MenuToggle
                                        ref={toggleRef}
                                        onClick={() => setLevelSelectOpen(!levelSelectOpen)}
                                        isExpanded={levelSelectOpen}
                                        className="debug-panel__select"
                                    >
                                        Level: {filterLevel}
                                    </MenuToggle>
                                )}
                            >
                                <SelectOption value="all">All Levels</SelectOption>
                                <SelectOption value="debug">Debug</SelectOption>
                                <SelectOption value="info">Info</SelectOption>
                                <SelectOption value="warn">Warning</SelectOption>
                                <SelectOption value="error">Error</SelectOption>
                            </Select>
                        </FlexItem>
                        <FlexItem>
                            <Select
                                isOpen={categorySelectOpen}
                                onOpenChange={setCategorySelectOpen}
                                selected={filterCategory}
                                onSelect={(_e, value) => {
                                    setFilterCategory(value as LogCategory | 'all');
                                    setCategorySelectOpen(false);
                                }}
                                toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                                    <MenuToggle
                                        ref={toggleRef}
                                        onClick={() => setCategorySelectOpen(!categorySelectOpen)}
                                        isExpanded={categorySelectOpen}
                                        className="debug-panel__select"
                                    >
                                        Category: {filterCategory === 'all' ? 'All' : CATEGORY_CONFIG[filterCategory]?.label}
                                    </MenuToggle>
                                )}
                            >
                                <SelectOption value="all">All Categories</SelectOption>
                                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                                    <SelectOption key={key} value={key}>{config.label}</SelectOption>
                                ))}
                            </Select>
                        </FlexItem>
                        {isPaused && (
                            <FlexItem>
                                <Badge className="debug-panel__paused-badge">PAUSED</Badge>
                            </FlexItem>
                        )}
                    </Flex>
                </div>
            )}

            {/* Log entries */}
            {!isMinimized && (
                <div className="debug-panel__logs">
                    {filteredEntries.length === 0 ? (
                        <div className="debug-panel__empty">
                            <BugIcon className="debug-panel__empty-icon" />
                            <p>No log entries yet</p>
                            <p className="debug-panel__empty-hint">
                                Logs will appear here as you interact with the AI
                            </p>
                        </div>
                    ) : (
                        filteredEntries.map(entry => (
                            <LogEntryRow
                                key={entry.id}
                                entry={entry}
                                isExpanded={expandedIds.has(entry.id)}
                                onToggle={() => toggleExpand(entry.id)}
                            />
                        ))
                    )}
                    <div ref={logsEndRef} />
                </div>
            )}
        </div>
    );
};

// Individual log entry row
const LogEntryRow: React.FC<{
    entry: LogEntry;
    isExpanded: boolean;
    onToggle: () => void;
}> = ({ entry, isExpanded, onToggle }) => {
    const categoryConfig = CATEGORY_CONFIG[entry.category];
    const levelConfig = LEVEL_CONFIG[entry.level];
    const hasData = entry.data !== undefined;

    const formatTime = (date: Date) => {
        const h = date.getHours().toString().padStart(2, '0');
        const m = date.getMinutes().toString().padStart(2, '0');
        const s = date.getSeconds().toString().padStart(2, '0');
        const ms = date.getMilliseconds().toString().padStart(3, '0');
        return `${h}:${m}:${s}.${ms}`;
    };

    return (
        <div
            className={`debug-entry debug-entry--${entry.level}`}
            style={{ backgroundColor: levelConfig.bg }}
        >
            <button
                className="debug-entry__header"
                onClick={onToggle}
                disabled={!hasData}
            >
                <span className="debug-entry__expand">
                    {hasData ? (
                        isExpanded ? <AngleDownIcon /> : <AngleRightIcon />
                    ) : (
                        <span style={{ width: 14 }} />
                    )}
                </span>
                <span className="debug-entry__time">{formatTime(entry.timestamp)}</span>
                <span
                    className="debug-entry__category"
                    style={{ color: categoryConfig.color }}
                >
                    [{categoryConfig.label}]
                </span>
                <span
                    className="debug-entry__title"
                    style={{ color: levelConfig.color }}
                >
                    {entry.title}
                </span>
                <span className="debug-entry__message">{entry.message}</span>
                {entry.duration !== undefined && (
                    <span className="debug-entry__duration">{entry.duration}ms</span>
                )}
            </button>
            {isExpanded && hasData && (
                <div className="debug-entry__data">
                    {entry.category === 'ai-parse' ? (
                        <>
                            <div style={{ marginBottom: '8px', color: 'var(--pf-v5-global--primary-color--100)' }}><strong>Raw Output:</strong></div>
                            <pre style={{ marginBottom: '16px', background: 'var(--pf-v5-global--BackgroundColor--light-300)', padding: '8px', borderRadius: '4px', border: '1px solid var(--pf-v5-global--BorderColor--100)', whiteSpace: 'pre-wrap' }}>
                                {entry.data.raw}
                            </pre>
                            <div style={{ marginBottom: '8px', color: 'var(--pf-v5-global--primary-color--100)' }}><strong>Parsed Instructions:</strong></div>
                            <pre style={{ background: 'var(--pf-v5-global--BackgroundColor--dark-transparent-100)', padding: '8px', borderRadius: '4px' }}>
                                {JSON.stringify(entry.data.parsed, null, 2)}
                            </pre>
                        </>
                    ) : entry.category === 'action' ? (
                        <>
                            <div style={{ marginBottom: '8px', color: 'var(--pf-v5-global--primary-color--100)' }}><strong>Action Execution:</strong></div>
                            <pre style={{ background: 'var(--pf-v5-global--BackgroundColor--dark-transparent-100)', padding: '8px', borderRadius: '4px' }}>{JSON.stringify(entry.data, null, 2)}</pre>
                        </>
                    ) : (
                        <pre style={{ background: 'var(--pf-v5-global--BackgroundColor--dark-transparent-100)', padding: '8px', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(entry.data, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
};

export default DebugPanel;
