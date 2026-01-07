/**
 * @simplens/gmail
 * 
 * Gmail/SMTP email provider plugin for SimpleNS.
 * Uses Nodemailer for email delivery.
 */

import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';
import {
    z,
    type SimpleNSProvider,
    type ProviderManifest,
    type ProviderConfig,
    type DeliveryResult,
    type RateLimitConfig,
    baseNotificationSchema,
    isHtmlContent,
} from '@simplens/sdk';

/**
 * Attachment interface for embedded images
 */
interface ImageAttachment {
    filename: string;
    content: Buffer;
    cid: string;
    contentType: string;
}

/**
 * Result of extracting base64 images from HTML
 */
interface ExtractedImages {
    html: string;
    attachments: ImageAttachment[];
}

/**
 * Extracts base64 encoded images from HTML and converts them to CID attachments.
 * This is necessary because most email clients block inline base64 images.
 * 
 * @param html - The HTML content containing base64 images
 * @returns Object with processed HTML (cid: references) and attachments array
 */
function extractBase64Images(html: string): ExtractedImages {
    const attachments: ImageAttachment[] = [];

    // Regex to match base64 image data URIs in img src attributes
    // Matches: <img ... src="data:image/TYPE;base64,DATA" ...>
    const base64ImageRegex = /<img([^>]*)\ssrc=["']data:(image\/(\w+));base64,([^"']+)["']([^>]*)>/gi;

    let imageIndex = 0;
    const processedHtml = html.replace(base64ImageRegex, (match, before, mimeType, extension, base64Data, after) => {
        const cid = `embedded-image-${imageIndex}-${Date.now()}`;
        const filename = `image-${imageIndex}.${extension}`;

        attachments.push({
            filename,
            content: Buffer.from(base64Data, 'base64'),
            cid,
            contentType: mimeType,
        });

        imageIndex++;
        return `<img${before} src="cid:${cid}"${after}>`;
    });

    return { html: processedHtml, attachments };
}

/**
 * Replaces template variables in a string using multiple common patterns.
 * 
 * Supported patterns:
 * - {{variable}} - Handlebars/Mustache style
 * - ${variable}  - ES6 template literal style
 * - {variable}   - Simple brace style
 * - $variable    - Shell/PHP style (word characters only)
 * 
 * @param template - The template string containing variables
 * @param variables - Record of variable names to values
 * @returns The template with all variables replaced
 */
function replaceTemplateVariables(
    template: string,
    variables: Record<string, unknown>
): string {
    let result = template;

    // Define all supported patterns with their regex
    // Order matters: more specific patterns first to avoid partial matches
    const patterns = [
        /\{\{(\w+)\}\}/g,  // {{variable}}
        /\$\{(\w+)\}/g,    // ${variable}
        /\{(\w+)\}/g,      // {variable}
        /\$(\w+)/g,        // $variable
    ];

    for (const pattern of patterns) {
        result = result.replace(pattern, (match, varName) => {
            if (varName in variables) {
                return String(variables[varName]);
            }
            return match; // Leave unmatched patterns as-is
        });
    }

    return result;
}

/**
 * Email recipient schema
 */
const recipientSchema = z.object({
    user_id: z.string(),
    email: z.string().email(),
});

/**
 * Email content schema
 */
const contentSchema = z.object({
    subject: z.string().optional(),
    message: z.string(),
});

/**
 * Complete Gmail notification schema
 */
const gmailNotificationSchema = baseNotificationSchema.extend({
    channel: z.literal('email'),
    recipient: recipientSchema,
    content: contentSchema,
    created_at: z.coerce.date(),
});

/**
 * Gmail notification type
 */
export type GmailNotification = z.infer<typeof gmailNotificationSchema>;

/**
 * Gmail Provider
 * 
 * Sends emails using Gmail SMTP via Nodemailer.
 * 
 * Required credentials:
 * - EMAIL_HOST: SMTP host (default: smtp.gmail.com)
 * - EMAIL_PORT: SMTP port (default: 587)
 * - EMAIL_USER: Gmail address
 * - EMAIL_PASS: App password (not regular password)
 * 
 * Optional:
 * - EMAIL_FROM: From address (defaults to EMAIL_USER)
 */
export class GmailProvider implements SimpleNSProvider<GmailNotification> {
    private transporter: Transporter | null = null;
    private fromEmail: string = '';
    private config: ProviderConfig | null = null;

    readonly manifest: ProviderManifest = {
        name: 'simplens-plugin-nodemailer-gmail',
        version: '1.0.0',
        channel: 'email',
        displayName: 'Gmail (Nodemailer)',
        description: 'Send emails via Gmail SMTP using Nodemailer',
        author: 'Adhish Krishna S',
        homepage: 'https://github.com/SimpleNotificationSystem/plugin-nodemailer-gmail',
        requiredCredentials: ['EMAIL_USER', 'EMAIL_PASS'],
        optionalConfig: ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM'],
    };

    getNotificationSchema() {
        return gmailNotificationSchema;
    }

    getRecipientSchema() {
        return recipientSchema;
    }

    getContentSchema() {
        return contentSchema;
    }

    getRateLimitConfig(): RateLimitConfig {
        // Gmail limits: ~500 emails/day for regular accounts
        // ~2000/day for Google Workspace
        // Default: 100 tokens, refill 10/second (~100/min max)
        const options = this.config?.options as Record<string, unknown> | undefined;
        const rateLimit = options?.rateLimit as { maxTokens?: number; refillRate?: number } | undefined;

        return {
            maxTokens: rateLimit?.maxTokens || 100,
            refillRate: rateLimit?.refillRate || 10,
        };
    }

    async initialize(config: ProviderConfig): Promise<void> {
        this.config = config;

        const host = config.options?.['EMAIL_HOST'] as string || 'smtp.gmail.com';
        const port = parseInt(config.options?.['EMAIL_PORT'] as string || '587', 10);
        const user = config.credentials['EMAIL_USER'];
        const pass = config.credentials['EMAIL_PASS'];

        if (!user || !pass) {
            throw new Error('EMAIL_USER and EMAIL_PASS are required');
        }

        this.fromEmail = config.credentials['EMAIL_FROM'] || user;

        this.transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 30000,
        });

        console.log(`[GmailProvider] Initialized with host: ${host}:${port}`);
    }

    async healthCheck(): Promise<boolean> {
        if (!this.transporter) {
            return false;
        }

        try {
            await this.transporter.verify();
            console.log('[GmailProvider] SMTP connection verified');
            return true;
        } catch (err) {
            console.error('[GmailProvider] Health check failed:', err);
            return false;
        }
    }

    async send(notification: GmailNotification): Promise<DeliveryResult> {
        if (!this.transporter) {
            return {
                success: false,
                error: {
                    code: 'NOT_INITIALIZED',
                    message: 'Transporter not initialized',
                    retryable: false,
                },
            };
        }

        try {
            let message = notification.content.message;

            // Replace template variables using our custom multi-pattern replacer
            if (notification.variables) {
                message = replaceTemplateVariables(message, notification.variables);
            }

            // Detect if message is HTML
            const isHtml = isHtmlContent(message);

            let mailOptions: SendMailOptions;

            if (isHtml) {
                // Extract base64 images and convert to CID attachments
                const { html, attachments } = extractBase64Images(message);
                mailOptions = {
                    from: this.fromEmail,
                    to: notification.recipient.email,
                    subject: notification.content.subject || 'Notification',
                    html,
                    attachments,
                };
            } else {
                mailOptions = {
                    from: this.fromEmail,
                    to: notification.recipient.email,
                    subject: notification.content.subject || 'Notification',
                    text: message,
                };
            }

            const info = await this.transporter.sendMail(mailOptions);

            console.log(`[GmailProvider] Email sent: ${info.messageId} to ${notification.recipient.email}`);

            return {
                success: true,
                messageId: info.messageId,
                providerResponse: info,
            };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';

            // Determine if retryable
            // Common non-retryable errors: invalid address, auth failure
            const nonRetryablePatterns = [
                'Invalid login',
                'Authentication',
                'Invalid mail',
                'No recipients',
                'Invalid email',
            ];

            const retryable = !nonRetryablePatterns.some(p =>
                errorMessage.toLowerCase().includes(p.toLowerCase())
            );

            console.error(`[GmailProvider] Send failed:`, err);

            return {
                success: false,
                error: {
                    code: 'SEND_FAILED',
                    message: errorMessage,
                    retryable,
                },
            };
        }
    }

    async shutdown(): Promise<void> {
        if (this.transporter) {
            this.transporter.close();
            this.transporter = null;
            console.log('[GmailProvider] Transporter closed');
        }
    }
}

// Export the provider class as default
export default GmailProvider;

// Also export a factory function for convenience
export function createProvider(): GmailProvider {
    return new GmailProvider();
}
