# Wikang Tagalog confirmation email

The copy-ready HTML is `confirmation.html`. It uses email-compatible presentation tables and inline styles, with the warm orb and serif wordmark from Wikang Tagalog. There are no remote images, fonts, or tracking pixels. Supabase supplies and escapes the real confirmation URL at send time.

## Apply to the hosted project

Open [Authentication → Emails → Confirm sign up](https://supabase.com/dashboard/project/ggzncypdmjzwgwkttlfj/auth/templates).

- Subject: **Confirm your Wikang Tagalog account**
- Body: paste all of `confirmation.html` into the source editor, preserving `{{ .ConfirmationURL }}` in both links and the fallback text.
- Save the template. A website deployment does not apply Supabase email settings.
- Confirm that Authentication → URL Configuration uses `https://wikang-tagalog.vercel.app` as the Site URL. Keep any existing required redirect allowlist entries.

The browser client already handles Supabase confirmation sessions on return to the website. The desktop uses the same shared Auth project; confirmation should return to the website.

## Brand the sender

Under [Authentication → Emails → SMTP Settings](https://supabase.com/dashboard/project/ggzncypdmjzwgwkttlfj/auth/smtp), configure an existing email provider's SMTP host, port, username and password, plus a verified From address on a domain you control. Set **Sender name** to **Wikang Tagalog**. Enter SMTP secrets directly in Supabase; do not commit them or put them into `VITE_` environment variables. Disable the provider's link tracking for these authentication emails.

The default Supabase sender name and address remain until custom SMTP is configured. Supabase's built-in SMTP is for testing with project-team addresses; configure custom SMTP before opening sign-up to the public.

References: [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
