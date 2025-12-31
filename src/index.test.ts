import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodemailer from 'nodemailer';
import { GmailProvider, createProvider, type GmailNotification } from './index.js';
import { type UUID } from 'crypto';

// Mock nodemailer
vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(),
    },
}));

// Mock @simplens/sdk
vi.mock('@simplens/sdk', async () => {
    const { z } = await import('zod');
    return {
        z,
        baseNotificationSchema: z.object({
            notification_id: z.string(),
            channel: z.string(),
            priority: z.enum(['high', 'normal', 'low']).optional(),
            variables: z.record(z.string(), z.unknown()).optional(),
        }),
        replaceVariables: vi.fn((message: string, variables: Record<string, unknown>) => {
            let result = message;
            for (const [key, value] of Object.entries(variables)) {
                result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
            }
            return result;
        }),
        isHtmlContent: vi.fn((content: string) => {
            return /<[^>]+>/.test(content);
        }),
    };
});

describe('GmailProvider', () => {
    let provider: GmailProvider;
    let mockTransporter: {
        verify: ReturnType<typeof vi.fn>;
        sendMail: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        provider = new GmailProvider();
        mockTransporter = {
            verify: vi.fn(),
            sendMail: vi.fn(),
            close: vi.fn(),
        };
        vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as any);

        // Suppress console.log/error during tests
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('manifest', () => {
        it('should have correct manifest properties', () => {
            expect(provider.manifest).toEqual({
                name: 'simplens-plugin-nodemailer-gmail',
                version: '1.0.0',
                channel: 'email',
                displayName: 'Gmail (Nodemailer)',
                description: 'Send emails via Gmail SMTP using Nodemailer',
                author: 'Adhish Krishna S',
                homepage: 'https://github.com/SimpleNotificationSystem/plugin-nodemailer-gmail',
                requiredCredentials: ['EMAIL_USER', 'EMAIL_PASS'],
                optionalConfig: ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM'],
            });
        });
    });

    describe('getNotificationSchema', () => {
        it('should return a valid zod schema', () => {
            const schema = provider.getNotificationSchema();
            expect(schema).toBeDefined();
            expect(typeof schema.parse).toBe('function');
        });
    });

    describe('getRecipientSchema', () => {
        it('should return a valid zod schema', () => {
            const schema = provider.getRecipientSchema();
            expect(schema).toBeDefined();
            expect(typeof schema.parse).toBe('function');
        });

        it('should validate correct recipient', () => {
            const schema = provider.getRecipientSchema();
            const result = schema.safeParse({
                user_id: 'user123',
                email: 'test@example.com',
            });
            expect(result.success).toBe(true);
        });

        it('should reject invalid email', () => {
            const schema = provider.getRecipientSchema();
            const result = schema.safeParse({
                user_id: 'user123',
                email: 'invalid-email',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('getContentSchema', () => {
        it('should return a valid zod schema', () => {
            const schema = provider.getContentSchema();
            expect(schema).toBeDefined();
            expect(typeof schema.parse).toBe('function');
        });

        it('should validate content with subject', () => {
            const schema = provider.getContentSchema();
            const result = schema.safeParse({
                subject: 'Test Subject',
                message: 'Test message',
            });
            expect(result.success).toBe(true);
        });

        it('should validate content without subject (optional)', () => {
            const schema = provider.getContentSchema();
            const result = schema.safeParse({
                message: 'Test message',
            });
            expect(result.success).toBe(true);
        });

        it('should reject content without message', () => {
            const schema = provider.getContentSchema();
            const result = schema.safeParse({
                subject: 'Test Subject',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('getRateLimitConfig', () => {
        it('should return default rate limit config when not initialized', () => {
            const config = provider.getRateLimitConfig();
            expect(config).toEqual({
                maxTokens: 100,
                refillRate: 10,
            });
        });

        it('should return custom rate limit config from options', async () => {
            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'test@gmail.com',
                    EMAIL_PASS: 'password123',
                },
                options: {
                    rateLimit: {
                        maxTokens: 200,
                        refillRate: 20,
                    },
                },
            });

            const config = provider.getRateLimitConfig();
            expect(config).toEqual({
                maxTokens: 200,
                refillRate: 20,
            });
        });
    });

    describe('initialize', () => {
        it('should initialize with required credentials', async () => {
            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'test@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            expect(nodemailer.createTransport).toHaveBeenCalledWith({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                auth: { user: 'test@gmail.com', pass: 'password123' },
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 30000,
            });
        });

        it('should use custom host and port', async () => {
            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'test@example.com',
                    EMAIL_PASS: 'password123',
                },
                options: {
                    EMAIL_HOST: 'smtp.example.com',
                    EMAIL_PORT: '465',
                }
            });

            expect(nodemailer.createTransport).toHaveBeenCalledWith({
                host: 'smtp.example.com',
                port: 465,
                secure: true, // Port 465 should be secure
                auth: { user: 'test@example.com', pass: 'password123' },
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 30000,
            });
        });

        it('should throw error when EMAIL_USER is missing', async () => {
            await expect(
                provider.initialize({
                    id: 'test',
                    credentials: {
                        EMAIL_PASS: 'password123',
                    },
                })
            ).rejects.toThrow('EMAIL_USER and EMAIL_PASS are required');
        });

        it('should throw error when EMAIL_PASS is missing', async () => {
            await expect(
                provider.initialize({
                    id: 'test',
                    credentials: {
                        EMAIL_USER: 'test@gmail.com',
                    },
                })
            ).rejects.toThrow('EMAIL_USER and EMAIL_PASS are required');
        });
    });

    describe('healthCheck', () => {
        it('should return false when transporter is not initialized', async () => {
            const result = await provider.healthCheck();
            expect(result).toBe(false);
        });

        it('should return true when transporter verification succeeds', async () => {
            mockTransporter.verify.mockResolvedValue(true);

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'test@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const result = await provider.healthCheck();
            expect(result).toBe(true);
            expect(mockTransporter.verify).toHaveBeenCalled();
        });

        it('should return false when transporter verification fails', async () => {
            mockTransporter.verify.mockRejectedValue(new Error('Connection failed'));

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'test@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const result = await provider.healthCheck();
            expect(result).toBe(false);
        });
    });

    describe('send', () => {
        const createNotification = (overrides: Partial<GmailNotification> = {}): GmailNotification => ({
            notification_id: 'notif-123',
            request_id: crypto.randomUUID() as UUID,
            client_id: crypto.randomUUID() as UUID,
            channel: 'email',
            recipient: {
                user_id: 'user-456',
                email: 'recipient@example.com',
            },
            webhook_url: 'https://example.com/webhook',
            retry_count: 3,
            content: {
                subject: 'Test Subject',
                message: 'Hello, this is a test message.',
            },
            created_at: new Date(),
            ...overrides,
        });

        it('should return error when transporter is not initialized', async () => {
            const notification = createNotification();
            const result = await provider.send(notification);

            expect(result.success).toBe(false);
            expect(result.error).toEqual({
                code: 'NOT_INITIALIZED',
                message: 'Transporter not initialized',
                retryable: false,
            });
        });

        it('should send email successfully with plain text', async () => {
            mockTransporter.sendMail.mockResolvedValue({
                messageId: '<msg-id-123@gmail.com>',
            });

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const notification = createNotification();
            const result = await provider.send(notification);

            expect(result.success).toBe(true);
            expect(result.messageId).toBe('<msg-id-123@gmail.com>');
            expect(mockTransporter.sendMail).toHaveBeenCalledWith({
                from: 'sender@gmail.com',
                to: 'recipient@example.com',
                subject: 'Test Subject',
                text: 'Hello, this is a test message.',
            });
        });

        it('should send email with HTML content', async () => {
            mockTransporter.sendMail.mockResolvedValue({
                messageId: '<msg-id-456@gmail.com>',
            });

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const notification = createNotification({
                content: {
                    subject: 'HTML Email',
                    message: '<h1>Hello</h1><p>This is HTML content</p>',
                },
            });

            const result = await provider.send(notification);

            expect(result.success).toBe(true);
            expect(mockTransporter.sendMail).toHaveBeenCalledWith({
                from: 'sender@gmail.com',
                to: 'recipient@example.com',
                subject: 'HTML Email',
                html: '<h1>Hello</h1><p>This is HTML content</p>',
            });
        });

        it('should use default subject when not provided', async () => {
            mockTransporter.sendMail.mockResolvedValue({
                messageId: '<msg-id-789@gmail.com>',
            });

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const notification = createNotification({
                content: {
                    message: 'Message without subject',
                },
            });

            const result = await provider.send(notification);

            expect(result.success).toBe(true);
            expect(mockTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Notification',
                })
            );
        });

        it('should replace template variables', async () => {
            mockTransporter.sendMail.mockResolvedValue({
                messageId: '<msg-id-var@gmail.com>',
            });

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const notification = createNotification({
                content: {
                    subject: 'Welcome',
                    message: 'Hello {{name}}, your order {{orderId}} is confirmed.',
                },
                variables: {
                    name: 'John',
                    orderId: '12345',
                },
            });

            const result = await provider.send(notification);

            expect(result.success).toBe(true);
            expect(mockTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    text: 'Hello John, your order 12345 is confirmed.',
                })
            );
        });

        it('should use custom FROM address', async () => {
            mockTransporter.sendMail.mockResolvedValue({
                messageId: '<msg-id-from@gmail.com>',
            });

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                    EMAIL_FROM: 'noreply@mycompany.com',
                },
            });

            const notification = createNotification();
            const result = await provider.send(notification);

            expect(result.success).toBe(true);
            expect(mockTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: 'noreply@mycompany.com',
                })
            );
        });

        it('should return retryable error for connection issues', async () => {
            mockTransporter.sendMail.mockRejectedValue(new Error('Connection timeout'));

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const notification = createNotification();
            const result = await provider.send(notification);

            expect(result.success).toBe(false);
            expect(result.error).toEqual({
                code: 'SEND_FAILED',
                message: 'Connection timeout',
                retryable: true,
            });
        });

        it('should return non-retryable error for authentication failure', async () => {
            mockTransporter.sendMail.mockRejectedValue(new Error('Invalid login credentials'));

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'wrong-password',
                },
            });

            const notification = createNotification();
            const result = await provider.send(notification);

            expect(result.success).toBe(false);
            expect(result.error?.retryable).toBe(false);
        });

        it('should return non-retryable error for invalid email address', async () => {
            mockTransporter.sendMail.mockRejectedValue(new Error('Invalid email address'));

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const notification = createNotification();
            const result = await provider.send(notification);

            expect(result.success).toBe(false);
            expect(result.error?.retryable).toBe(false);
        });

        it('should handle unknown error type', async () => {
            mockTransporter.sendMail.mockRejectedValue('String error');

            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'sender@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            const notification = createNotification();
            const result = await provider.send(notification);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Unknown error');
        });
    });

    describe('shutdown', () => {
        it('should close transporter when initialized', async () => {
            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'test@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            await provider.shutdown();

            expect(mockTransporter.close).toHaveBeenCalled();
        });

        it('should do nothing when transporter is not initialized', async () => {
            await provider.shutdown();
            expect(mockTransporter.close).not.toHaveBeenCalled();
        });

        it('should set transporter to null after shutdown', async () => {
            await provider.initialize({
                id: 'test',
                credentials: {
                    EMAIL_USER: 'test@gmail.com',
                    EMAIL_PASS: 'password123',
                },
            });

            await provider.shutdown();

            // Verify transporter is null by checking healthCheck returns false
            const result = await provider.healthCheck();
            expect(result).toBe(false);
        });
    });
});

describe('createProvider', () => {
    it('should create a new GmailProvider instance', () => {
        const provider = createProvider();
        expect(provider).toBeInstanceOf(GmailProvider);
    });
});
