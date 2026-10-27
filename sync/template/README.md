# Motus sync

Your own copy of this repository keeps [Motus](https://alyamimohd.github.io/motusapp/) up to date by itself:

- **Apple Health** (and everything that writes to it, such as MyFitnessPal): your iPhone sends the day's numbers here with the Motus Shortcut.
- **Hevy**: your workouts are fetched every 3 hours with your Hevy API key.

GitHub Actions does the work, for free. Before anything is published, your data is encrypted with a key that only you have (`MOTUS_KEY`). The repository can stay public: GitHub only ever stores and shows the encrypted file, and the job never prints your numbers.

## Set it up

The easiest way is the guided setup on Motus: **[Connect → Automatic](https://alyamimohd.github.io/motusapp/connect.html#auto)**. It takes about ten minutes, once:

1. **Use this template → Create a new repository** (name it `motus-sync`, keep it Public).
2. In Motus, **create your key**. Add it here: **Settings → Secrets and variables → Actions → New repository secret**, name `MOTUS_KEY`.
3. Optional, for Hevy (needs Hevy Pro): another secret, `HEVY_API_KEY`, with your key from hevy.com → Settings → Developer.
4. **Settings → Pages → Source: GitHub Actions.**
5. **Actions → Motus sync → Run workflow** once.
6. On your iPhone: create a phone token and add the Motus Shortcut (Motus shows you how), then a daily automation.

## Good to know

- If the job can't open the data already published with your `MOTUS_KEY`, it stops without changing anything. If you made a new key on purpose, run the workflow by hand with **Start over** ticked.
- When something goes wrong (for example Hevy rejects your key), the run fails and GitHub e-mails you. The data that did arrive is still published.
- The job runs the latest code from [alyamiMohd/motusapp](https://github.com/alyamiMohd/motusapp/tree/main/sync).
