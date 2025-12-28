/*
 * Type declarations for Cockpit
 */

declare module 'cockpit' {
    interface FileHandle<T = string> {
        read(): Promise<T | null>;
        replace(content: T): Promise<void>;
        watch(callback: (content: T | null) => void): void;
        close(): void;
    }

    interface FileOptions {
        superuser?: 'try' | 'require';
        syntax?: unknown;  // JSON parser or other syntax handler
    }

    interface SpawnOptions {
        pty?: boolean;
        environ?: string[];
        directory?: string;
        superuser?: 'try' | 'require';
        err?: 'out' | 'ignore' | 'message';
        /** Window size for PTY - required for interactive terminals */
        window?: {
            rows: number;
            cols: number;
        };
    }

    interface SpawnProcess {
        stream(callback: (data: string) => void): void;
        input(data: string): void;
        then<T>(resolve: (result: string) => T): Promise<T>;
        catch(reject: (error: { message: string; exit_status: number; exit_signal?: string }) => void): SpawnProcess;
        /** Send control commands to the channel (e.g., window-change for PTY resize) */
        control(options: { command: string;[key: string]: unknown }): void;
        /** Close the process channel */
        close(problem?: string): void;
    }

    interface UserInfo {
        name: string;
        full_name: string;
        home: string;
        shell: string;
        gid: number;
        uid: number;
        groups: string[];
    }

    function file(path: string, options?: FileOptions): FileHandle<unknown>;
    function spawn(command: string[], options?: SpawnOptions): SpawnProcess & Promise<string>;
    function gettext(text: string): string;
    function format(format: string, ...args: unknown[]): string;
    function user(): Promise<UserInfo>;

    const transport: {
        wait(callback: () => void): void;
    };
}

declare module 'cockpit-dark-theme' {
    // Dark theme module - side-effect import only
}
