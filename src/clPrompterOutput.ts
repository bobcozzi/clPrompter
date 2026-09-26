import * as vscode from 'vscode';

let clPrompterOutputChannel: vscode.OutputChannel | undefined;

export function setClPrompterOutputChannel(channel: vscode.OutputChannel): void {
    clPrompterOutputChannel = channel;
}

export function clearClPrompterOutputChannel(): void {
    clPrompterOutputChannel = undefined;
}

export function appendClPrompterOutputLine(message: string): void {
    try {
        clPrompterOutputChannel?.appendLine(message);
    } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!/channel has been closed/i.test(text)) {
            console.warn(`[clPrompter] Output append failed: ${text}`);
        }
    }
}
