---

### 🔐 What is `security.txt` in Solana?

The `security.txt` is similar to [security.txt for websites](https://securitytxt.org/), but in Solana it's **attached to a program account** using the **`security-txt` program** maintained by the Solana Foundation.

It helps researchers or auditors contact you if they find a vulnerability in your on-chain program.

---

### 🛠️ How to Add `security.txt` to Your Program

#### 1. **Create the `security.txt` File**
Make a plain text file with something like this:

```
Contact: mailto:security@yourdomain.com
Encryption: https://yourdomain.com/pgp-key.txt
Preferred-Languages: en
Acknowledgements: https://yourdomain.com/security/hall-of-fame
```

You can also just keep it minimal:
```
Contact: mailto:security@yourdomain.com
```

Save this as:  
```bash
security.txt
```

---

#### 2. **Install the `security-txt` CLI Tool**
```bash
cargo install security-txt
```

This is a CLI maintained by the [Solana security-txt repo](https://github.com/solana-labs/security-txt)

---

#### 3. **Upload `security.txt` to Your Program Account**
Make sure your validator or devnet is configured, and you’ve deployed your program. Then:

```bash
security-txt set \
  --program-id <YourProgramID> \
  --url http://127.0.0.1:8899 \
  --keypair ~/.config/solana/id.json \
  --file security.txt
```

Replace:
- `<YourProgramID>` → your deployed ID (e.g. `BBDD11ma...`)
- `--keypair` → your upgrade authority wallet
- `--url` → optional, if you're not using `localhost`

---

#### 4. **Check Explorer**
Reload Solana Explorer for your program, and you should see:

> ✅ Program has a valid `security.txt`

---

### 💡 Where to Keep It in Your Repo

You don’t need it in your deployed on-chain data — but for repo transparency:

- Place it in the root of your repo:
  ```
  /security.txt
  ```
- Or create a `docs/security.txt` if you have other public policies

---

Would you like a custom `security.txt` template pre-filled with your GitHub or contact details? I can write one for you now.