0x1404515f0: push rbp
0x1404515f2: push rsi
0x1404515f3: push rdi
0x1404515f4: push r12
0x1404515f6: push r15
0x1404515f8: sub rsp, 0x20
0x1404515fc: mov rax, qword ptr [rsp + 0x80]
0x140451604: mov ebp, 1
0x140451609: mov r12d, dword ptr [rsp + 0x78]
0x14045160e: mov esi, r9d
0x140451611: mov rdi, rcx
0x140451614: mov r15d, ebp
0x140451617: test rax, rax
0x14045161a: je 0x1404518b6
0x140451620: cmp byte ptr [rax], 0x31
0x140451623: jne 0x1404518b6
0x140451629: mov qword ptr [rsp + 0x58], r13
0x14045162e: mov qword ptr [rsp + 0x60], r14
0x140451633: test rcx, rcx
0x140451636: je 0x1404518af
0x14045163c: cmp qword ptr [rdi + 0x30], 0
0x140451641: mov qword ptr [rcx + 0x20], 0
0x140451649: lea rcx, [rip - 0x6640]   ; -> 0x14044b010
0x140451650: jne 0x14045165e
0x140451652: mov qword ptr [rdi + 0x30], rcx
0x140451656: mov qword ptr [rdi + 0x40], 0
0x14045165e: cmp qword ptr [rdi + 0x38], 0
0x140451663: jne 0x140451670
0x140451665: lea rax, [rip - 0x666c]   ; -> 0x14044b000
0x14045166c: mov qword ptr [rdi + 0x38], rax
0x140451670: cmp edx, -1
0x140451673: mov r14d, 6
0x140451679: cmovne r14d, edx
0x14045167d: test esi, esi
0x14045167f: jns 0x140451688
0x140451681: xor r15d, r15d
0x140451684: neg esi
0x140451686: jmp 0x140451696
0x140451688: cmp esi, 0xf
0x14045168b: jle 0x140451696
0x14045168d: mov r15d, 2
0x140451693: sub esi, 0x10
0x140451696: mov r13d, dword ptr [rsp + 0x70]
0x14045169b: lea eax, [r13 - 1]
0x14045169f: cmp eax, 8
0x1404516a2: ja 0x1404518af
0x1404516a8: cmp r8d, 8
0x1404516ac: jne 0x1404518af
0x1404516b2: lea eax, [rsi - 8]
0x1404516b5: cmp eax, 7
0x1404516b8: ja 0x1404518af
0x1404516be: cmp r14d, 9
0x1404516c2: ja 0x1404518af
0x1404516c8: cmp r12d, 4
0x1404516cc: ja 0x1404518af
0x1404516d2: cmp esi, r8d
0x1404516d5: mov qword ptr [rsp + 0x50], rbx
0x1404516da: mov eax, 9
0x1404516df: cmove esi, eax
0x1404516e2: mov rax, qword ptr [rdi + 0x30]
0x1404516e6: cmp rax, rcx
0x1404516e9: jne 0x1404516f7
0x1404516eb: mov ecx, 0x1718
0x1404516f0: call 0x1402ec108
0x1404516f5: jmp 0x140451705
0x1404516f7: mov rcx, qword ptr [rdi + 0x40]
0x1404516fb: mov r8d, 0x1718
0x140451701: mov edx, ebp
0x140451703: call rax
0x140451705: mov rbx, rax
0x140451708: test rax, rax
0x14045170b: je 0x1404518a8
0x140451711: mov qword ptr [rdi + 0x28], rax
0x140451715: mov ecx, esi
0x140451717: mov dword ptr [rax + 0x48], esi
0x14045171a: mov r9d, ebp
0x14045171d: mov qword ptr [rax], rdi
0x140451720: lea rsi, [rip - 0x6717]   ; -> 0x14044b010
0x140451727: mov dword ptr [rax + 0x2c], r15d
0x14045172b: mov qword ptr [rax + 0x30], 0
0x140451733: shl r9d, cl
0x140451736: lea ecx, [r13 + 7]
0x14045173a: mov dword ptr [rax + 0x44], r9d
0x14045173e: mov dword ptr [rbx + 0x78], ecx
0x140451741: lea eax, [r9 - 1]
0x140451745: mov dword ptr [rbx + 0x4c], eax
0x140451748: mov eax, ebp
0x14045174a: shl eax, cl
0x14045174c: add ecx, 2
0x14045174f: mov dword ptr [rbx + 0x74], eax
0x140451752: dec eax
0x140451754: mov dword ptr [rbx + 0x7c], eax
0x140451757: mov eax, 0xaaaaaaab
0x14045175c: mul ecx
0x14045175e: shr edx, 1
0x140451760: mov dword ptr [rbx + 0x80], edx
0x140451766: mov rax, qword ptr [rdi + 0x30]
0x14045176a: cmp rax, rsi
0x14045176d: jne 0x14045177a
0x14045176f: lea ecx, [r9 + r9]
0x140451773: call 0x1402ec108
0x140451778: jmp 0x140451789
0x14045177a: mov rcx, qword ptr [rdi + 0x40]
0x14045177e: mov r8d, 2
0x140451784: mov edx, r9d
0x140451787: call rax
0x140451789: mov edx, dword ptr [rbx + 0x44]
0x14045178c: mov qword ptr [rbx + 0x50], rax
0x140451790: mov rax, qword ptr [rdi + 0x30]
0x140451794: cmp rax, rsi
0x140451797: jne 0x1404517a3
0x140451799: lea ecx, [rdx + rdx]
0x14045179c: call 0x1402ec108
0x1404517a1: jmp 0x1404517af
0x1404517a3: mov rcx, qword ptr [rdi + 0x40]
0x1404517a7: mov r8d, 2
0x1404517ad: call rax
0x1404517af: mov edx, dword ptr [rbx + 0x74]
0x1404517b2: mov qword ptr [rbx + 0x60], rax
0x1404517b6: mov rax, qword ptr [rdi + 0x30]
0x1404517ba: cmp rax, rsi
0x1404517bd: jne 0x1404517c9
0x1404517bf: lea ecx, [rdx + rdx]
0x1404517c2: call 0x1402ec108
0x1404517c7: jmp 0x1404517d5
0x1404517c9: mov rcx, qword ptr [rdi + 0x40]
0x1404517cd: mov r8d, 2
0x1404517d3: call rax
0x1404517d5: lea ecx, [r13 + 6]
0x1404517d9: mov qword ptr [rbx + 0x68], rax
0x1404517dd: shl ebp, cl
0x1404517df: mov dword ptr [rbx + 0x16f0], ebp
0x1404517e5: mov rax, qword ptr [rdi + 0x30]
0x1404517e9: cmp rax, rsi
0x1404517ec: jne 0x1404517fc
0x1404517ee: lea ecx, [rbp*4]
0x1404517f5: call 0x1402ec108
0x1404517fa: jmp 0x14045180a
0x1404517fc: mov rcx, qword ptr [rdi + 0x40]
0x140451800: mov r8d, 4
0x140451806: mov edx, ebp
0x140451808: call rax
0x14045180a: cmp qword ptr [rbx + 0x50], 0
0x14045180f: mov rdx, rax
0x140451812: mov ecx, dword ptr [rbx + 0x16f0]
0x140451818: mov qword ptr [rbx + 0x10], rax
0x14045181c: lea eax, [rcx*4]
0x140451823: mov dword ptr [rbx + 0x18], eax
0x140451826: je 0x14045188e
0x140451828: cmp qword ptr [rbx + 0x60], 0
0x14045182d: je 0x14045188e
0x14045182f: cmp qword ptr [rbx + 0x68], 0
0x140451834: je 0x14045188e
0x140451836: test rdx, rdx
0x140451839: je 0x14045188e
0x14045183b: mov eax, ecx
0x14045183d: mov dword ptr [rbx + 0xac], r14d
0x140451844: shr rax, 1
0x140451847: mov dword ptr [rbx + 0xb0], r12d
0x14045184e: mov byte ptr [rbx + 0x3c], 8
0x140451852: lea rax, [rdx + rax*2]
0x140451856: mov qword ptr [rbx + 0x16f8], rax
0x14045185d: lea rax, [rdx + rcx*2]
0x140451861: add rcx, rax
0x140451864: mov qword ptr [rbx + 0x16e8], rcx
0x14045186b: mov rcx, rdi
0x14045186e: call 0x140451440
0x140451873: mov rbx, qword ptr [rsp + 0x50]
0x140451878: mov r13, qword ptr [rsp + 0x58]
0x14045187d: mov r14, qword ptr [rsp + 0x60]
0x140451882: add rsp, 0x20
0x140451886: pop r15
0x140451888: pop r12
0x14045188a: pop rdi
0x14045188b: pop rsi
0x14045188c: pop rbp
0x14045188d: ret 
0x14045188e: lea rax, [rip + 0x3c3093]   ; "insufficient memory"
0x140451895: mov dword ptr [rbx + 8], 0x29a
0x14045189c: mov rcx, rdi
0x14045189f: mov qword ptr [rdi + 0x20], rax
0x1404518a3: call 0x140450860
0x1404518a8: mov eax, 0xfffffffc
0x1404518ad: jmp 0x140451873
0x1404518af: mov eax, 0xfffffffe
0x1404518b4: jmp 0x140451878
0x1404518b6: mov eax, 0xfffffffa
0x1404518bb: add rsp, 0x20
0x1404518bf: pop r15
0x1404518c1: pop r12
0x1404518c3: pop rdi
0x1404518c4: pop rsi
0x1404518c5: pop rbp
0x1404518c6: ret 
0x1404518c7: int3 
0x1404518c8: int3 
0x1404518c9: int3 
0x1404518ca: int3 
0x1404518cb: int3 
0x1404518cc: int3 
0x1404518cd: int3 
0x1404518ce: int3 
0x1404518cf: int3 
0x1404518d0: push rdi
0x1404518d2: mov r10d, r8d
0x1404518d5: lea rdi, [rip + 0x3c5644]   ; -> 0x140816f20
0x1404518dc: mov r8, rdx
0x1404518df: bswap ecx
0x1404518e1: not ecx
0x1404518e3: test r10d, r10d
0x1404518e6: je 0x14045190e
0x1404518e8: test r8b, 3
0x1404518ec: je 0x14045190e
0x1404518ee: movzx eax, byte ptr [r8]
0x1404518f2: inc r8
0x1404518f5: mov edx, ecx
0x1404518f7: shr rdx, 0x18
0x1404518fb: xor rdx, rax
0x1404518fe: shl ecx, 8
0x140451901: xor ecx, dword ptr [rdi + rdx*4 + 0x1000]
0x140451908: add r10d, -1
0x14045190c: jne 0x1404518e8
0x14045190e: lea r11, [r8 - 4]
0x140451912: cmp r10d, 0x20
0x140451916: jb 0x140451b73
0x14045191c: mov qword ptr [rsp + 0x10], rbx
0x140451921: mov ebx, r10d
0x140451924: shr rbx, 5
0x140451928: nop dword ptr [rax + rax]
0x140451930: xor ecx, dword ptr [r11 + 4]
0x140451934: mov r9d, ecx
0x140451937: mov eax, ecx
0x140451939: shr rax, 0x10
0x14045193d: movzx edx, al
0x140451940: mov eax, ecx
0x140451942: shr rax, 8
0x140451946: movzx ecx, al
0x140451949: mov eax, r9d
0x14045194c: mov r8d, dword ptr [rdi + rdx*4 + 0x1800]
0x140451954: shr rax, 0x18
0x140451958: xor r8d, dword ptr [rdi + rcx*4 + 0x1400]
0x140451960: xor r8d, dword ptr [rdi + rax*4 + 0x1c00]
0x140451968: movzx eax, r9b
0x14045196c: xor r8d, dword ptr [rdi + rax*4 + 0x1000]
0x140451974: xor r8d, dword ptr [r11 + 8]
0x140451978: mov r9d, r8d
0x14045197b: mov eax, r8d
0x14045197e: shr rax, 0x10
0x140451982: movzx edx, al
0x140451985: mov eax, r8d
0x140451988: shr rax, 8
0x14045198c: movzx ecx, al
0x14045198f: mov eax, r9d
0x140451992: mov r8d, dword ptr [rdi + rdx*4 + 0x1800]
0x14045199a: shr rax, 0x18
0x14045199e: xor r8d, dword ptr [rdi + rcx*4 + 0x1400]
0x1404519a6: xor r8d, dword ptr [rdi + rax*4 + 0x1c00]
0x1404519ae: movzx eax, r9b
0x1404519b2: xor r8d, dword ptr [rdi + rax*4 + 0x1000]
0x1404519ba: xor r8d, dword ptr [r11 + 0xc]
0x1404519be: mov r9d, r8d
0x1404519c1: mov eax, r8d
0x1404519c4: shr rax, 0x10
0x1404519c8: movzx edx, al
0x1404519cb: mov eax, r8d
0x1404519ce: shr rax, 8
0x1404519d2: movzx ecx, al
0x1404519d5: mov eax, r9d
0x1404519d8: mov r8d, dword ptr [rdi + rdx*4 + 0x1800]
0x1404519e0: shr rax, 0x18
0x1404519e4: xor r8d, dword ptr [rdi + rcx*4 + 0x1400]
0x1404519ec: xor r8d, dword ptr [rdi + rax*4 + 0x1c00]
0x1404519f4: movzx eax, r9b
0x1404519f8: xor r8d, dword ptr [rdi + rax*4 + 0x1000]
0x140451a00: xor r8d, dword ptr [r11 + 0x10]
0x140451a04: mov r9d, r8d
0x140451a07: mov eax, r8d
0x140451a0a: shr rax, 0x10
0x140451a0e: movzx edx, al
0x140451a11: mov eax, r8d
0x140451a14: shr rax, 8
0x140451a18: movzx ecx, al
0x140451a1b: mov eax, r9d
0x140451a1e: mov r8d, dword ptr [rdi + rdx*4 + 0x1800]
0x140451a26: shr rax, 0x18
0x140451a2a: xor r8d, dword ptr [rdi + rcx*4 + 0x1400]
0x140451a32: xor r8d, dword ptr [rdi + rax*4 + 0x1c00]
0x140451a3a: movzx eax, r9b
0x140451a3e: xor r8d, dword ptr [rdi + rax*4 + 0x1000]
0x140451a46: xor r8d, dword ptr [r11 + 0x14]
0x140451a4a: mov r9d, r8d
0x140451a4d: mov eax, r8d
0x140451a50: shr rax, 0x10
0x140451a54: movzx edx, al
0x140451a57: mov eax, r8d
0x140451a5a: shr rax, 8
0x140451a5e: movzx ecx, al
0x140451a61: mov eax, r9d
0x140451a64: mov r8d, dword ptr [rdi + rdx*4 + 0x1800]
0x140451a6c: shr rax, 0x18
0x140451a70: xor r8d, dword ptr [rdi + rcx*4 + 0x1400]
0x140451a78: xor r8d, dword ptr [rdi + rax*4 + 0x1c00]
0x140451a80: movzx eax, r9b
0x140451a84: xor r8d, dword ptr [rdi + rax*4 + 0x1000]
0x140451a8c: xor r8d, dword ptr [r11 + 0x18]
0x140451a90: mov eax, r8d
0x140451a93: shr rax, 0x10
0x140451a97: movzx edx, al
0x140451a9a: mov eax, r8d
0x140451a9d: mov r9d, r8d
0x140451aa0: mov r8d, dword ptr [rdi + rdx*4 + 0x1800]
0x140451aa8: add r10d, -0x20
0x140451aac: shr rax, 8
0x140451ab0: movzx ecx, al
0x140451ab3: mov eax, r9d
0x140451ab6: shr rax, 0x18
0x140451aba: xor r8d, dword ptr [rdi + rcx*4 + 0x1400]
0x140451ac2: xor r8d, dword ptr [rdi + rax*4 + 0x1c00]
0x140451aca: movzx eax, r9b
0x140451ace: xor r8d, dword ptr [rdi + rax*4 + 0x1000]
0x140451ad6: xor r8d, dword ptr [r11 + 0x1c]
0x140451ada: add r11, 0x20
0x140451ade: mov edx, r8d
0x140451ae1: mov eax, r8d
0x140451ae4: shr rax, 0x10
0x140451ae8: movzx ecx, al
0x140451aeb: mov eax, edx
0x140451aed: shr rax, 8
0x140451af1: mov r8d, dword ptr [rdi + rcx*4 + 0x1800]
0x140451af9: movzx ecx, al
0x140451afc: mov eax, dword ptr [rdi + rcx*4 + 0x1400]
0x140451b03: xor r8, rax
0x140451b06: mov eax, edx
0x140451b08: shr rax, 0x18
0x140451b0c: mov eax, dword ptr [rdi + rax*4 + 0x1c00]
0x140451b13: xor r8, rax
0x140451b16: movzx eax, dl
0x140451b19: mov eax, dword ptr [rdi + rax*4 + 0x1000]
0x140451b20: xor r8, rax
0x140451b23: mov eax, dword ptr [r11]
0x140451b26: xor r8, rax
0x140451b29: mov rax, r8
0x140451b2c: shr rax, 0x10
0x140451b30: movzx ecx, al
0x140451b33: mov rax, r8
0x140451b36: shr rax, 8
0x140451b3a: movzx edx, al
0x140451b3d: mov rax, r8
0x140451b40: shr rax, 0x18
0x140451b44: mov ecx, dword ptr [rdi + rcx*4 + 0x1800]
0x140451b4b: xor ecx, dword ptr [rdi + rdx*4 + 0x1400]
0x140451b52: xor ecx, dword ptr [rdi + rax*4 + 0x1c00]
0x140451b59: movzx eax, r8b
0x140451b5d: xor ecx, dword ptr [rdi + rax*4 + 0x1000]
0x140451b64: sub rbx, 1
0x140451b68: jne 0x140451930
0x140451b6e: mov rbx, qword ptr [rsp + 0x10]
0x140451b73: cmp r10d, 4
0x140451b77: jb 0x140451bd2
0x140451b79: mov r9d, r10d
0x140451b7c: shr r9, 2
0x140451b80: mov r8d, dword ptr [r11 + 4]
0x140451b84: add r11, 4
0x140451b88: mov eax, ecx
0x140451b8a: add r10d, -4
0x140451b8e: xor r8, rax
0x140451b91: mov rax, r8
0x140451b94: shr rax, 0x10
0x140451b98: movzx ecx, al
0x140451b9b: mov rax, r8
0x140451b9e: shr rax, 8
0x140451ba2: movzx edx, al
0x140451ba5: mov rax, r8
0x140451ba8: shr rax, 0x18
0x140451bac: mov ecx, dword ptr [rdi + rcx*4 + 0x1800]
0x140451bb3: xor ecx, dword ptr [rdi + rdx*4 + 0x1400]
0x140451bba: xor ecx, dword ptr [rdi + rax*4 + 0x1c00]
0x140451bc1: movzx eax, r8b
0x140451bc5: xor ecx, dword ptr [rdi + rax*4 + 0x1000]
0x140451bcc: sub r9, 1
0x140451bd0: jne 0x140451b80
0x140451bd2: add r11, 4
0x140451bd6: test r10d, r10d
0x140451bd9: je 0x140451c01
0x140451bdb: nop dword ptr [rax + rax]
0x140451be0: movzx eax, byte ptr [r11]
0x140451be4: lea r11, [r11 + 1]
0x140451be8: mov edx, ecx
0x140451bea: shr rdx, 0x18
0x140451bee: xor rdx, rax
0x140451bf1: shl ecx, 8
0x140451bf4: xor ecx, dword ptr [rdi + rdx*4 + 0x1000]
0x140451bfb: add r10d, -1
0x140451bff: jne 0x140451be0
0x140451c01: not ecx
0x140451c03: bswap ecx
0x140451c05: mov eax, ecx
0x140451c07: pop rdi
0x140451c08: ret 
0x140451c09: int3 
0x140451c0a: int3 
0x140451c0b: int3 
0x140451c0c: int3 
0x140451c0d: int3 
0x140451c0e: int3 
0x140451c0f: int3 
