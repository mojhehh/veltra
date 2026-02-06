---
applyTo: '**'
---

Provide project context and coding guidelines that AI should follow when generating code, answering questions, or reviewing changes.

**Project Context:**  
You are building a **web-based online operating system**. Users can interact with apps, files, and settings entirely in a browser. The OS should be **secure, reliable, and performant**, capable of handling real-world users, network conditions, and malicious attempts.

**Guidelines for AI:**

1. **Pre-code self-simulation:**  
   Before generating any code, simulate the feature as if you are a user trying to break it:  
   - What happens if the user inputs invalid or malicious data?  
   - What if network requests fail, timeout, or are delayed?  
   - Could multiple users interacting simultaneously break the feature?  
   - Could browser limitations (old versions, mobile devices, slow CPUs) cause issues?  
   - Are there security risks like XSS, CSRF, privilege escalation, or data leaks?  
   - Would this approach scale for hundreds or thousands of users?  

2. **Self-questioning before coding:**  
   Ask yourself:  
   - Will this feature actually work in real usage?  
   - Is this design maintainable long-term?  
   - Would a professional company approve this approach?  
   - Does it solve user problems, or just look impressive?  
   - Could this unintentionally create new bugs or vulnerabilities?  

3. **Coding practices:**  
   - Prioritize security, performance, and maintainability.  
   - Handle errors explicitly (network failures, permissions, storage limits).  
   - Keep code modular, readable, and debuggable.  
   - Avoid hacks, unnecessary complexity, or shortcuts.  
   - Optimize resource usage (CPU, memory, storage).  
   - Assume users may act unexpectedly or maliciously.

4. **Post-code self-review:**  
   After generating code, answer:  
   - Could this fail under slow networks or old devices?  
   - Are there any security vulnerabilities?  
   - How would this behave if multiple users interact simultaneously?  
   - Is this code clear and maintainable?  
   - Could this introduce hidden bugs or issues?  
   - Is there a simpler, safer, or faster alternative?  

5. **Handling risky ideas:**  
   - Clearly identify risky or unsafe approaches.  
   - Explain why something could fail or be dangerous.  
   - Suggest safer, more maintainable alternatives.  

**Goal:**  
Generate **production-ready, secure, and maintainable online OS code** that is resilient to user errors, attacks, and browser limitations.  Always think like a user, a security researcher, and a professional developer to ensure the best possible outcome.


