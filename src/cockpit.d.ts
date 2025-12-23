/*
 * Type declarations for Cockpit
 */

declare module 'cockpit' {
    interface FileHandle {
        read(): Promise<string | null>;
        replace(content: string): Promise<void>;
        watch(callback: (content: string | null) => void): void;
        close(): void;
    }

    interface FileOptions {
        superuser?: 'try' | 'require';
    }

    interface SpawnOptions {
        pty?: boolean;
        environ?: string[];
        directory?: string;
        superuser?: 'try' | 'require';
    }

    interface SpawnProcess {
        stream(callback: (data: string) => void): void;
        input(data: string): void;
        then(resolve: () => void): SpawnProcess;
        catch(reject: (error: { message: string; exit_status: number }) => void): SpawnProcess;
    }

    function file(path: string, options?: FileOptions): FileHandle;
    function spawn(command: string[], options?: SpawnOptions): SpawnProcess;
    function gettext(text: string): string;
    function format(format: string, ...args: unknown[]): string;

    const transport: {
        wait(callback: () => void): void;
    };
}

declare module 'cockpit-dark-theme' {
    // Dark theme module - side-effect import only
}
