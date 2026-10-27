# Security

Kashiro runs offline and reads and writes the user's files, so file-access bugs matter. Examples: reading or writing outside the file the user chose, the AI helper loading a model from an unexpected place, or a crafted `.docx` making the app misbehave.

## Reporting a problem

Please **don't open a public issue**. Use GitHub's private vulnerability reporting instead: the **Security** tab of this repository, then **Report a vulnerability**.

Include the steps or the file that triggers it, what happens, and the version (shown under About).

You'll get an answer within a week. Once a fix is released, you'll be credited in the release notes unless you'd rather not be.

## Supported versions

Only the latest release gets security fixes.
