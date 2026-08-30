0x140450950: push rbx
0x140450952: push rdi
0x140450953: push r14
0x140450955: sub rsp, 0x20
0x140450959: mov r14d, edx
0x14045095c: mov rdi, rcx
0x14045095f: test rcx, rcx
0x140450962: je 0x140451280
0x140450968: mov rbx, qword ptr [rcx + 0x28]
0x14045096c: test rbx, rbx
0x14045096f: je 0x140451280
0x140450975: cmp edx, 4
0x140450978: ja 0x140451280
0x14045097e: cmp qword ptr [rcx + 0x10], 0
0x140450983: je 0x140451275
0x140450989: cmp qword ptr [rcx], 0
0x14045098d: jne 0x140450999
0x14045098f: cmp dword ptr [rcx + 8], 0
0x140450993: jne 0x140451275
0x140450999: mov eax, dword ptr [rbx + 8]
0x14045099c: cmp eax, 0x29a
0x1404509a1: jne 0x1404509ad
0x1404509a3: cmp r14d, 4
0x1404509a7: jne 0x140451275
0x1404509ad: cmp dword ptr [rcx + 0x18], 0
0x1404509b1: mov qword ptr [rsp + 0x48], rsi
0x1404509b6: mov qword ptr [rsp + 0x50], r15
0x1404509bb: je 0x140451260
0x1404509c1: mov r15d, dword ptr [rbx + 0x40]
0x1404509c5: xor esi, esi
0x1404509c7: mov qword ptr [rbx], rdi
0x1404509ca: mov dword ptr [rbx + 0x40], r14d
0x1404509ce: cmp eax, 0x2a
0x1404509d1: jne 0x140450d35
0x1404509d7: cmp dword ptr [rbx + 0x2c], 2
0x1404509db: jne 0x140450c2c
0x1404509e1: mov dword ptr [rcx + 0x4c], esi
0x1404509e4: mov ecx, dword ptr [rbx + 0x28]
0x1404509e7: mov rax, qword ptr [rbx + 0x10]
0x1404509eb: mov byte ptr [rcx + rax], 0x1f
0x1404509ef: mov ecx, dword ptr [rbx + 0x28]
0x1404509f2: mov rax, qword ptr [rbx + 0x10]
0x1404509f6: inc ecx
0x1404509f8: mov dword ptr [rbx + 0x28], ecx
0x1404509fb: mov byte ptr [rcx + rax], 0x8b
0x1404509ff: mov ecx, dword ptr [rbx + 0x28]
0x140450a02: mov rax, qword ptr [rbx + 0x10]
0x140450a06: inc ecx
0x140450a08: mov dword ptr [rbx + 0x28], ecx
0x140450a0b: mov byte ptr [rcx + rax], 8
0x140450a0f: mov r8d, dword ptr [rbx + 0x28]
0x140450a13: mov r9, qword ptr [rbx + 0x30]
0x140450a17: inc r8d
0x140450a1a: mov dword ptr [rbx + 0x28], r8d
0x140450a1e: test r9, r9
0x140450a21: jne 0x140450ac1
0x140450a27: mov rax, qword ptr [rbx + 0x10]
0x140450a2b: mov byte ptr [r8 + rax], sil
0x140450a2f: mov ecx, dword ptr [rbx + 0x28]
0x140450a32: mov rax, qword ptr [rbx + 0x10]
0x140450a36: inc ecx
0x140450a38: mov dword ptr [rbx + 0x28], ecx
0x140450a3b: mov byte ptr [rcx + rax], sil
0x140450a3f: mov ecx, dword ptr [rbx + 0x28]
0x140450a42: mov rax, qword ptr [rbx + 0x10]
0x140450a46: inc ecx
0x140450a48: mov dword ptr [rbx + 0x28], ecx
0x140450a4b: mov byte ptr [rcx + rax], sil
0x140450a4f: mov ecx, dword ptr [rbx + 0x28]
0x140450a52: mov rax, qword ptr [rbx + 0x10]
0x140450a56: inc ecx
0x140450a58: mov dword ptr [rbx + 0x28], ecx
0x140450a5b: mov byte ptr [rcx + rax], sil
0x140450a5f: mov ecx, dword ptr [rbx + 0x28]
0x140450a62: mov rax, qword ptr [rbx + 0x10]
0x140450a66: inc ecx
0x140450a68: mov dword ptr [rbx + 0x28], ecx
0x140450a6b: mov byte ptr [rcx + rax], sil
0x140450a6f: mov ecx, dword ptr [rbx + 0x28]
0x140450a72: mov eax, dword ptr [rbx + 0xac]
0x140450a78: inc ecx
0x140450a7a: mov dword ptr [rbx + 0x28], ecx
0x140450a7d: cmp eax, 9
0x140450a80: jne 0x140450a86
0x140450a82: mov dl, 2
0x140450a84: jmp 0x140450a9a
0x140450a86: cmp dword ptr [rbx + 0xb0], 2
0x140450a8d: jge 0x140450a98
0x140450a8f: cmp eax, 2
0x140450a92: jl 0x140450a98
0x140450a94: xor dl, dl
0x140450a96: jmp 0x140450a9a
0x140450a98: mov dl, 4
0x140450a9a: mov rax, qword ptr [rbx + 0x10]
0x140450a9e: mov byte ptr [rcx + rax], dl
0x140450aa1: mov ecx, dword ptr [rbx + 0x28]
0x140450aa4: mov rax, qword ptr [rbx + 0x10]
0x140450aa8: inc ecx
0x140450aaa: mov dword ptr [rbx + 0x28], ecx
0x140450aad: mov byte ptr [rcx + rax], 0xb
0x140450ab1: mov eax, 0x71
0x140450ab6: inc dword ptr [rbx + 0x28]
0x140450ab9: mov dword ptr [rbx + 8], eax
0x140450abc: jmp 0x140450d35
0x140450ac1: mov rax, qword ptr [r9 + 0x30]
0x140450ac5: neg rax
0x140450ac8: mov eax, dword ptr [r9 + 0x3c]
0x140450acc: sbb dl, dl
0x140450ace: and dl, 0x10
0x140450ad1: neg eax
0x140450ad3: mov rax, qword ptr [r9 + 0x20]
0x140450ad7: sbb cl, cl
0x140450ad9: and cl, 2
0x140450adc: add dl, cl
0x140450ade: neg rax
0x140450ae1: mov rax, qword ptr [r9 + 0x10]
0x140450ae5: sbb cl, cl
0x140450ae7: and cl, 8
0x140450aea: add dl, cl
0x140450aec: neg rax
0x140450aef: sbb cl, cl
0x140450af1: and cl, 4
0x140450af4: add dl, cl
0x140450af6: cmp dword ptr [r9], esi
0x140450af9: setne al
0x140450afc: add dl, al
0x140450afe: mov rax, qword ptr [rbx + 0x10]
0x140450b02: mov byte ptr [r8 + rax], dl
0x140450b06: mov edx, dword ptr [rbx + 0x28]
0x140450b09: mov rax, qword ptr [rbx + 0x30]
0x140450b0d: inc edx
0x140450b0f: mov rcx, qword ptr [rbx + 0x10]
0x140450b13: mov dword ptr [rbx + 0x28], edx
0x140450b16: movzx eax, byte ptr [rax + 4]
0x140450b1a: mov byte ptr [rdx + rcx], al
0x140450b1d: mov edx, dword ptr [rbx + 0x28]
0x140450b20: mov rax, qword ptr [rbx + 0x30]
0x140450b24: inc edx
0x140450b26: mov rcx, qword ptr [rbx + 0x10]
0x140450b2a: mov dword ptr [rbx + 0x28], edx
0x140450b2d: movzx eax, byte ptr [rax + 5]
0x140450b31: mov byte ptr [rdx + rcx], al
0x140450b34: mov edx, dword ptr [rbx + 0x28]
0x140450b37: mov rax, qword ptr [rbx + 0x30]
0x140450b3b: inc edx
0x140450b3d: mov rcx, qword ptr [rbx + 0x10]
0x140450b41: mov dword ptr [rbx + 0x28], edx
0x140450b44: movzx eax, byte ptr [rax + 6]
0x140450b48: mov byte ptr [rdx + rcx], al
0x140450b4b: mov edx, dword ptr [rbx + 0x28]
0x140450b4e: mov rax, qword ptr [rbx + 0x30]
0x140450b52: inc edx
0x140450b54: mov rcx, qword ptr [rbx + 0x10]
0x140450b58: mov dword ptr [rbx + 0x28], edx
0x140450b5b: movzx eax, byte ptr [rax + 7]
0x140450b5f: mov byte ptr [rdx + rcx], al
0x140450b62: mov ecx, dword ptr [rbx + 0x28]
0x140450b65: mov eax, dword ptr [rbx + 0xac]
0x140450b6b: inc ecx
0x140450b6d: mov dword ptr [rbx + 0x28], ecx
0x140450b70: cmp eax, 9
0x140450b73: jne 0x140450b79
0x140450b75: mov dl, 2
0x140450b77: jmp 0x140450b8d
0x140450b79: cmp dword ptr [rbx + 0xb0], 2
0x140450b80: jge 0x140450b8b
0x140450b82: cmp eax, 2
0x140450b85: jl 0x140450b8b
0x140450b87: xor dl, dl
0x140450b89: jmp 0x140450b8d
0x140450b8b: mov dl, 4
0x140450b8d: mov rax, qword ptr [rbx + 0x10]
0x140450b91: mov byte ptr [rcx + rax], dl
0x140450b94: mov edx, dword ptr [rbx + 0x28]
0x140450b97: mov rax, qword ptr [rbx + 0x30]
0x140450b9b: inc edx
0x140450b9d: mov rcx, qword ptr [rbx + 0x10]
0x140450ba1: mov dword ptr [rbx + 0x28], edx
0x140450ba4: movzx eax, byte ptr [rax + 0xc]
0x140450ba8: mov byte ptr [rdx + rcx], al
0x140450bab: mov r8d, dword ptr [rbx + 0x28]
0x140450baf: mov rax, qword ptr [rbx + 0x30]
0x140450bb3: inc r8d
0x140450bb6: mov dword ptr [rbx + 0x28], r8d
0x140450bba: cmp qword ptr [rax + 0x10], rsi
0x140450bbe: je 0x140450bea
0x140450bc0: movzx eax, byte ptr [rax + 0x18]
0x140450bc4: mov rcx, qword ptr [rbx + 0x10]
0x140450bc8: mov byte ptr [r8 + rcx], al
0x140450bcc: mov edx, dword ptr [rbx + 0x28]
0x140450bcf: mov rax, qword ptr [rbx + 0x30]
0x140450bd3: inc edx
0x140450bd5: mov rcx, qword ptr [rbx + 0x10]
0x140450bd9: mov dword ptr [rbx + 0x28], edx
0x140450bdc: movzx eax, byte ptr [rax + 0x19]
0x140450be0: mov byte ptr [rdx + rcx], al
0x140450be3: inc dword ptr [rbx + 0x28]
0x140450be6: mov r8d, dword ptr [rbx + 0x28]
0x140450bea: mov rax, qword ptr [rbx + 0x30]
0x140450bee: cmp dword ptr [rax + 0x3c], esi
0x140450bf1: je 0x140450c1c
0x140450bf3: mov rdx, qword ptr [rbx + 0x10]
0x140450bf7: test rdx, rdx
0x140450bfa: jne 0x140450c11
0x140450bfc: mov eax, esi
0x140450bfe: mov dword ptr [rdi + 0x4c], eax
0x140450c01: mov eax, 0x45
0x140450c06: mov dword ptr [rbx + 0x38], esi
0x140450c09: mov dword ptr [rbx + 8], eax
0x140450c0c: jmp 0x140450d35
0x140450c11: mov ecx, dword ptr [rdi + 0x4c]
0x140450c14: call 0x140451c10
0x140450c19: mov dword ptr [rdi + 0x4c], eax
0x140450c1c: mov eax, 0x45
0x140450c21: mov dword ptr [rbx + 0x38], esi
0x140450c24: mov dword ptr [rbx + 8], eax
0x140450c27: jmp 0x140450d35
0x140450c2c: mov ecx, dword ptr [rbx + 0x48]
0x140450c2f: shl ecx, 0xc
0x140450c32: sub ecx, 0x7800
0x140450c38: cmp dword ptr [rbx + 0xb0], 2
0x140450c3f: mov r8d, ecx
0x140450c42: jge 0x140450c7a
0x140450c44: mov eax, dword ptr [rbx + 0xac]
0x140450c4a: cmp eax, 2
0x140450c4d: jl 0x140450c7a
0x140450c4f: cmp eax, 6
0x140450c52: jge 0x140450c60
0x140450c54: mov eax, 0x40
0x140450c59: mov edx, 0x60
0x140450c5e: jmp 0x140450c81
0x140450c60: jne 0x140450c6e
0x140450c62: mov eax, 0x80
0x140450c67: mov edx, 0xa0
0x140450c6c: jmp 0x140450c81
0x140450c6e: mov eax, 0xc0
0x140450c73: mov edx, 0xe0
0x140450c78: jmp 0x140450c81
0x140450c7a: mov eax, esi
0x140450c7c: mov edx, 0x20
0x140450c81: or ecx, eax
0x140450c83: cmp dword ptr [rbx + 0x94], esi
0x140450c89: je 0x140450c90
0x140450c8b: mov ecx, edx
0x140450c8d: or ecx, r8d
0x140450c90: mov eax, 0x8421085
0x140450c95: mov dword ptr [rbx + 8], 0x71
0x140450c9c: mul ecx
0x140450c9e: mov rax, qword ptr [rbx + 0x10]
0x140450ca2: sub ecx, edx
0x140450ca4: shr ecx, 1
0x140450ca6: add ecx, edx
0x140450ca8: shr ecx, 4
0x140450cab: inc ecx
0x140450cad: imul r8d, ecx, 0x1f
0x140450cb1: mov ecx, dword ptr [rbx + 0x28]
0x140450cb4: mov edx, r8d
0x140450cb7: shr edx, 8
0x140450cba: mov byte ptr [rcx + rax], dl
0x140450cbd: mov ecx, dword ptr [rbx + 0x28]
0x140450cc0: mov rax, qword ptr [rbx + 0x10]
0x140450cc4: inc ecx
0x140450cc6: mov dword ptr [rbx + 0x28], ecx
0x140450cc9: mov byte ptr [rcx + rax], r8b
0x140450ccd: mov eax, dword ptr [rbx + 0x28]
0x140450cd0: inc eax
0x140450cd2: mov dword ptr [rbx + 0x28], eax
0x140450cd5: cmp dword ptr [rbx + 0x94], esi
0x140450cdb: je 0x140450d2e
0x140450cdd: movzx r8d, word ptr [rdi + 0x4e]
0x140450ce2: mov ecx, eax
0x140450ce4: mov edx, r8d
0x140450ce7: mov rax, qword ptr [rbx + 0x10]
0x140450ceb: shr edx, 8
0x140450cee: mov byte ptr [rcx + rax], dl
0x140450cf1: mov ecx, dword ptr [rbx + 0x28]
0x140450cf4: mov rax, qword ptr [rbx + 0x10]
0x140450cf8: inc ecx
0x140450cfa: mov dword ptr [rbx + 0x28], ecx
0x140450cfd: mov byte ptr [rcx + rax], r8b
0x140450d01: mov edx, dword ptr [rbx + 0x28]
0x140450d04: mov rax, qword ptr [rbx + 0x10]
0x140450d08: inc edx
0x140450d0a: mov dword ptr [rbx + 0x28], edx
0x140450d0d: movzx r8d, word ptr [rdi + 0x4c]
0x140450d12: mov ecx, r8d
0x140450d15: shr ecx, 8
0x140450d18: mov byte ptr [rdx + rax], cl
0x140450d1b: mov ecx, dword ptr [rbx + 0x28]
0x140450d1e: mov rax, qword ptr [rbx + 0x10]
0x140450d22: inc ecx
0x140450d24: mov dword ptr [rbx + 0x28], ecx
0x140450d27: mov byte ptr [rcx + rax], r8b
0x140450d2b: inc dword ptr [rbx + 0x28]
0x140450d2e: mov dword ptr [rdi + 0x4c], 1
0x140450d35: cmp dword ptr [rbx + 8], 0x45
0x140450d39: jne 0x140450e16
0x140450d3f: mov rdx, qword ptr [rbx + 0x30]
0x140450d43: cmp qword ptr [rdx + 0x10], rsi
0x140450d47: je 0x140450e0f
0x140450d4d: movzx eax, word ptr [rdx + 0x18]
0x140450d51: mov r9d, dword ptr [rbx + 0x28]
0x140450d55: mov ecx, r9d
0x140450d58: cmp dword ptr [rbx + 0x38], eax
0x140450d5b: jae 0x140450dd4
0x140450d5d: nop dword ptr [rax]
0x140450d60: cmp ecx, dword ptr [rbx + 0x18]
0x140450d63: jne 0x140450da2
0x140450d65: cmp dword ptr [rdx + 0x3c], esi
0x140450d68: je 0x140450d8d
0x140450d6a: cmp ecx, r9d
0x140450d6d: jbe 0x140450d8d
0x140450d6f: sub ecx, r9d
0x140450d72: mov edx, r9d
0x140450d75: add rdx, qword ptr [rbx + 0x10]
0x140450d79: jne 0x140450d7f
0x140450d7b: mov eax, esi
0x140450d7d: jmp 0x140450d8a
0x140450d7f: mov r8d, ecx
0x140450d82: mov ecx, dword ptr [rdi + 0x4c]
0x140450d85: call 0x140451c10
0x140450d8a: mov dword ptr [rdi + 0x4c], eax
0x140450d8d: mov rcx, rdi
0x140450d90: call 0x1404512a0
0x140450d95: mov r9d, dword ptr [rbx + 0x28]
0x140450d99: mov ecx, r9d
0x140450d9c: cmp r9d, dword ptr [rbx + 0x18]
0x140450da0: je 0x140450dd4
0x140450da2: mov r8d, dword ptr [rbx + 0x38]
0x140450da6: mov rax, qword ptr [rbx + 0x30]
0x140450daa: mov edx, ecx
0x140450dac: mov rcx, qword ptr [rbx + 0x10]
0x140450db0: mov rax, qword ptr [rax + 0x10]
0x140450db4: movzx eax, byte ptr [r8 + rax]
0x140450db9: mov byte ptr [rdx + rcx], al
0x140450dbc: inc dword ptr [rbx + 0x38]
0x140450dbf: mov ecx, dword ptr [rbx + 0x28]
0x140450dc2: inc ecx
0x140450dc4: mov dword ptr [rbx + 0x28], ecx
0x140450dc7: mov rdx, qword ptr [rbx + 0x30]
0x140450dcb: movzx eax, word ptr [rdx + 0x18]
0x140450dcf: cmp dword ptr [rbx + 0x38], eax
0x140450dd2: jb 0x140450d60
0x140450dd4: mov rax, qword ptr [rbx + 0x30]
0x140450dd8: cmp dword ptr [rax + 0x3c], esi
0x140450ddb: je 0x140450e00
0x140450ddd: cmp ecx, r9d
0x140450de0: jbe 0x140450e00
0x140450de2: sub ecx, r9d
0x140450de5: mov edx, r9d
0x140450de8: add rdx, qword ptr [rbx + 0x10]
0x140450dec: jne 0x140450df2
0x140450dee: mov eax, esi
0x140450df0: jmp 0x140450dfd
0x140450df2: mov r8d, ecx
0x140450df5: mov ecx, dword ptr [rdi + 0x4c]
0x140450df8: call 0x140451c10
0x140450dfd: mov dword ptr [rdi + 0x4c], eax
0x140450e00: mov rax, qword ptr [rbx + 0x30]
0x140450e04: mov ecx, dword ptr [rax + 0x18]
0x140450e07: cmp dword ptr [rbx + 0x38], ecx
0x140450e0a: jne 0x140450e16
0x140450e0c: mov dword ptr [rbx + 0x38], esi
0x140450e0f: mov dword ptr [rbx + 8], 0x49
0x140450e16: cmp dword ptr [rbx + 8], 0x49
0x140450e1a: mov qword ptr [rsp + 0x40], rbp
0x140450e1f: jne 0x140450ee9
0x140450e25: mov rax, qword ptr [rbx + 0x30]
0x140450e29: cmp qword ptr [rax + 0x20], rsi
0x140450e2d: je 0x140450ee2
0x140450e33: mov edx, dword ptr [rbx + 0x28]
0x140450e36: mov r8d, edx
0x140450e39: nop dword ptr [rax]
0x140450e40: cmp r8d, dword ptr [rbx + 0x18]
0x140450e44: jne 0x140450e7f
0x140450e46: mov rax, qword ptr [rbx + 0x30]
0x140450e4a: cmp dword ptr [rax + 0x3c], esi
0x140450e4d: je 0x140450e6c
0x140450e4f: cmp r8d, edx
0x140450e52: jbe 0x140450e6c
0x140450e54: sub r8d, edx
0x140450e57: add rdx, qword ptr [rbx + 0x10]
0x140450e5b: jne 0x140450e61
0x140450e5d: mov eax, esi
0x140450e5f: jmp 0x140450e69
0x140450e61: mov ecx, dword ptr [rdi + 0x4c]
0x140450e64: call 0x140451c10
0x140450e69: mov dword ptr [rdi + 0x4c], eax
0x140450e6c: mov rcx, rdi
0x140450e6f: call 0x1404512a0
0x140450e74: mov edx, dword ptr [rbx + 0x28]
0x140450e77: mov r8d, edx
0x140450e7a: cmp edx, dword ptr [rbx + 0x18]
0x140450e7d: je 0x140450eb0
0x140450e7f: mov ecx, dword ptr [rbx + 0x38]
0x140450e82: mov rax, qword ptr [rbx + 0x30]
0x140450e86: mov rax, qword ptr [rax + 0x20]
0x140450e8a: movzx ebp, byte ptr [rcx + rax]
0x140450e8e: lea eax, [rcx + 1]
0x140450e91: mov ecx, r8d
0x140450e94: mov dword ptr [rbx + 0x38], eax
0x140450e97: mov rax, qword ptr [rbx + 0x10]
0x140450e9b: mov byte ptr [rcx + rax], bpl
0x140450e9f: mov r8d, dword ptr [rbx + 0x28]
0x140450ea3: inc r8d
0x140450ea6: mov dword ptr [rbx + 0x28], r8d
0x140450eaa: test ebp, ebp
0x140450eac: jne 0x140450e40
0x140450eae: jmp 0x140450eb5
0x140450eb0: mov ebp, 1
0x140450eb5: mov rax, qword ptr [rbx + 0x30]
0x140450eb9: cmp dword ptr [rax + 0x3c], esi
0x140450ebc: je 0x140450edb
0x140450ebe: cmp r8d, edx
0x140450ec1: jbe 0x140450edb
0x140450ec3: sub r8d, edx
0x140450ec6: add rdx, qword ptr [rbx + 0x10]
0x140450eca: jne 0x140450ed0
0x140450ecc: mov eax, esi
0x140450ece: jmp 0x140450ed8
0x140450ed0: mov ecx, dword ptr [rdi + 0x4c]
0x140450ed3: call 0x140451c10
0x140450ed8: mov dword ptr [rdi + 0x4c], eax
0x140450edb: test ebp, ebp
0x140450edd: jne 0x140450ee9
0x140450edf: mov dword ptr [rbx + 0x38], esi
0x140450ee2: mov dword ptr [rbx + 8], 0x5b
0x140450ee9: cmp dword ptr [rbx + 8], 0x5b
0x140450eed: jne 0x140450fad
0x140450ef3: mov rax, qword ptr [rbx + 0x30]
0x140450ef7: cmp qword ptr [rax + 0x30], rsi
0x140450efb: je 0x140450fa6
0x140450f01: mov edx, dword ptr [rbx + 0x28]
0x140450f04: mov r8d, edx
0x140450f07: cmp r8d, dword ptr [rbx + 0x18]
0x140450f0b: jne 0x140450f46
0x140450f0d: mov rax, qword ptr [rbx + 0x30]
0x140450f11: cmp dword ptr [rax + 0x3c], esi
0x140450f14: je 0x140450f33
0x140450f16: cmp r8d, edx
0x140450f19: jbe 0x140450f33
0x140450f1b: sub r8d, edx
0x140450f1e: add rdx, qword ptr [rbx + 0x10]
0x140450f22: jne 0x140450f28
0x140450f24: mov eax, esi
0x140450f26: jmp 0x140450f30
0x140450f28: mov ecx, dword ptr [rdi + 0x4c]
0x140450f2b: call 0x140451c10
0x140450f30: mov dword ptr [rdi + 0x4c], eax
0x140450f33: mov rcx, rdi
0x140450f36: call 0x1404512a0
0x140450f3b: mov edx, dword ptr [rbx + 0x28]
0x140450f3e: mov r8d, edx
0x140450f41: cmp edx, dword ptr [rbx + 0x18]
0x140450f44: je 0x140450f77
0x140450f46: mov ecx, dword ptr [rbx + 0x38]
0x140450f49: mov rax, qword ptr [rbx + 0x30]
0x140450f4d: mov rax, qword ptr [rax + 0x30]
0x140450f51: movzx ebp, byte ptr [rcx + rax]
0x140450f55: lea eax, [rcx + 1]
0x140450f58: mov ecx, r8d
0x140450f5b: mov dword ptr [rbx + 0x38], eax
0x140450f5e: mov rax, qword ptr [rbx + 0x10]
0x140450f62: mov byte ptr [rcx + rax], bpl
0x140450f66: mov r8d, dword ptr [rbx + 0x28]
0x140450f6a: inc r8d
0x140450f6d: mov dword ptr [rbx + 0x28], r8d
0x140450f71: test ebp, ebp
0x140450f73: jne 0x140450f07
0x140450f75: jmp 0x140450f7c
0x140450f77: mov ebp, 1
0x140450f7c: mov rax, qword ptr [rbx + 0x30]
0x140450f80: cmp dword ptr [rax + 0x3c], esi
0x140450f83: je 0x140450fa2
0x140450f85: cmp r8d, edx
0x140450f88: jbe 0x140450fa2
0x140450f8a: sub r8d, edx
0x140450f8d: add rdx, qword ptr [rbx + 0x10]
0x140450f91: jne 0x140450f97
0x140450f93: mov eax, esi
0x140450f95: jmp 0x140450f9f
0x140450f97: mov ecx, dword ptr [rdi + 0x4c]
0x140450f9a: call 0x140451c10
0x140450f9f: mov dword ptr [rdi + 0x4c], eax
0x140450fa2: test ebp, ebp
0x140450fa4: jne 0x140450fad
0x140450fa6: mov dword ptr [rbx + 8], 0x67
0x140450fad: cmp dword ptr [rbx + 8], 0x67
0x140450fb1: mov rbp, qword ptr [rsp + 0x40]
0x140450fb6: jne 0x14045100c
0x140450fb8: mov rax, qword ptr [rbx + 0x30]
0x140450fbc: cmp dword ptr [rax + 0x3c], esi
0x140450fbf: je 0x140451005
0x140450fc1: mov eax, dword ptr [rbx + 0x28]
0x140450fc4: add eax, 2
0x140450fc7: cmp eax, dword ptr [rbx + 0x18]
0x140450fca: jbe 0x140450fd4
0x140450fcc: mov rcx, rdi
0x140450fcf: call 0x1404512a0
0x140450fd4: mov ecx, dword ptr [rbx + 0x28]
0x140450fd7: lea eax, [rcx + 2]
0x140450fda: cmp eax, dword ptr [rbx + 0x18]
0x140450fdd: ja 0x14045100c
0x140450fdf: movzx eax, byte ptr [rdi + 0x4c]
0x140450fe3: mov edx, ecx
0x140450fe5: mov rcx, qword ptr [rbx + 0x10]
0x140450fe9: mov byte ptr [rdx + rcx], al
0x140450fec: mov edx, dword ptr [rbx + 0x28]
0x140450fef: mov rcx, qword ptr [rbx + 0x10]
0x140450ff3: inc edx
0x140450ff5: mov dword ptr [rbx + 0x28], edx
0x140450ff8: movzx eax, byte ptr [rdi + 0x4d]
0x140450ffc: mov byte ptr [rdx + rcx], al
0x140450fff: inc dword ptr [rbx + 0x28]
0x140451002: mov dword ptr [rdi + 0x4c], esi
0x140451005: mov dword ptr [rbx + 8], 0x71
0x14045100c: cmp dword ptr [rbx + 0x28], esi
0x14045100f: je 0x140451028
0x140451011: mov rcx, rdi
0x140451014: call 0x1404512a0
0x140451019: cmp dword ptr [rdi + 0x18], esi
0x14045101c: je 0x140451252
0x140451022: lea rax, [rdi + 8]
0x140451026: jmp 0x140451048
0x140451028: lea rax, [rdi + 8]
0x14045102c: cmp dword ptr [rdi + 8], esi
0x14045102f: jne 0x140451048
0x140451031: lea rax, [rdi + 8]
0x140451035: cmp r14d, r15d
0x140451038: jg 0x140451048
0x14045103a: lea rax, [rdi + 8]
0x14045103e: cmp r14d, 4
0x140451042: jne 0x140451260
0x140451048: mov ecx, dword ptr [rbx + 8]
0x14045104b: cmp ecx, 0x29a
0x140451051: jne 0x14045105b
0x140451053: cmp dword ptr [rax], esi
0x140451055: jne 0x140451260
0x14045105b: cmp dword ptr [rax], esi
0x14045105d: jne 0x14045107c
0x14045105f: cmp dword ptr [rbx + 0x9c], esi
0x140451065: jne 0x14045107c
0x140451067: test r14d, r14d
0x14045106a: je 0x140451259
0x140451070: cmp ecx, 0x29a
0x140451076: je 0x140451112
0x14045107c: movsxd rax, dword ptr [rbx + 0xac]
0x140451083: lea r8, [rip + 0x3c5aae]   ; -> 0x140816b38
0x14045108a: add rax, rax
0x14045108d: mov edx, r14d
0x140451090: mov rcx, rbx
0x140451093: mov r8, qword ptr [r8 + rax*8]
0x140451097: call r8
0x14045109a: mov ecx, eax
0x14045109c: add eax, -2
0x14045109f: cmp eax, 1
0x1404510a2: ja 0x1404510ab
0x1404510a4: mov dword ptr [rbx + 8], 0x29a
0x1404510ab: test ecx, 0xfffffffd
0x1404510b1: je 0x14045124d
0x1404510b7: cmp ecx, 1
0x1404510ba: jne 0x140451112
0x1404510bc: mov rcx, rbx
0x1404510bf: cmp r14d, 1
0x1404510c3: jne 0x1404510cc
0x1404510c5: call 0x14044bad0
0x1404510ca: jmp 0x140451101
0x1404510cc: xor r9d, r9d
0x1404510cf: xor r8d, r8d
0x1404510d2: xor edx, edx
0x1404510d4: call 0x14044bcd0
0x1404510d9: cmp r14d, 3
0x1404510dd: jne 0x140451101
0x1404510df: mov ecx, dword ptr [rbx + 0x74]
0x1404510e2: xor edx, edx
0x1404510e4: mov rax, qword ptr [rbx + 0x68]
0x1404510e8: dec ecx
0x1404510ea: mov word ptr [rax + rcx*2], si
0x1404510ee: mov r8d, dword ptr [rbx + 0x74]
0x1404510f2: mov rcx, qword ptr [rbx + 0x68]
0x1404510f6: dec r8d
0x1404510f9: add r8, r8
0x1404510fc: call 0x140659f50
0x140451101: mov rcx, rdi
0x140451104: call 0x1404512a0
0x140451109: cmp dword ptr [rdi + 0x18], esi
0x14045110c: je 0x140451252
0x140451112: cmp r14d, 4
0x140451116: jne 0x140451259
0x14045111c: mov ecx, dword ptr [rbx + 0x2c]
0x14045111f: test ecx, ecx
0x140451121: jg 0x14045113b
0x140451123: mov eax, 1
0x140451128: mov rsi, qword ptr [rsp + 0x48]
0x14045112d: mov r15, qword ptr [rsp + 0x50]
0x140451132: add rsp, 0x20
0x140451136: pop r14
0x140451138: pop rdi
0x140451139: pop rbx
0x14045113a: ret 
0x14045113b: cmp ecx, 2
0x14045113e: jne 0x1404511d9
0x140451144: mov edx, dword ptr [rbx + 0x28]
0x140451147: movzx eax, byte ptr [rdi + 0x4c]
0x14045114b: mov rcx, qword ptr [rbx + 0x10]
0x14045114f: mov byte ptr [rdx + rcx], al
0x140451152: mov edx, dword ptr [rbx + 0x28]
0x140451155: mov rcx, qword ptr [rbx + 0x10]
0x140451159: inc edx
0x14045115b: mov dword ptr [rbx + 0x28], edx
0x14045115e: movzx eax, byte ptr [rdi + 0x4d]
0x140451162: mov byte ptr [rdx + rcx], al
0x140451165: mov edx, dword ptr [rbx + 0x28]
0x140451168: mov rcx, qword ptr [rbx + 0x10]
0x14045116c: inc edx
0x14045116e: mov dword ptr [rbx + 0x28], edx
0x140451171: movzx eax, byte ptr [rdi + 0x4e]
0x140451175: mov byte ptr [rdx + rcx], al
0x140451178: mov edx, dword ptr [rbx + 0x28]
0x14045117b: mov rcx, qword ptr [rbx + 0x10]
0x14045117f: inc edx
0x140451181: mov dword ptr [rbx + 0x28], edx
0x140451184: movzx eax, byte ptr [rdi + 0x4f]
0x140451188: mov byte ptr [rdx + rcx], al
0x14045118b: mov edx, dword ptr [rbx + 0x28]
0x14045118e: mov rcx, qword ptr [rbx + 0x10]
0x140451192: inc edx
0x140451194: mov dword ptr [rbx + 0x28], edx
0x140451197: movzx eax, byte ptr [rdi + 0xc]
0x14045119b: mov byte ptr [rdx + rcx], al
0x14045119e: mov edx, dword ptr [rbx + 0x28]
0x1404511a1: mov rcx, qword ptr [rbx + 0x10]
0x1404511a5: inc edx
0x1404511a7: mov dword ptr [rbx + 0x28], edx
0x1404511aa: movzx eax, byte ptr [rdi + 0xd]
0x1404511ae: mov byte ptr [rdx + rcx], al
0x1404511b1: mov edx, dword ptr [rbx + 0x28]
0x1404511b4: mov rcx, qword ptr [rbx + 0x10]
0x1404511b8: inc edx
0x1404511ba: mov dword ptr [rbx + 0x28], edx
0x1404511bd: movzx eax, byte ptr [rdi + 0xe]
0x1404511c1: mov byte ptr [rdx + rcx], al
0x1404511c4: mov edx, dword ptr [rbx + 0x28]
0x1404511c7: mov rcx, qword ptr [rbx + 0x10]
0x1404511cb: inc edx
0x1404511cd: mov dword ptr [rbx + 0x28], edx
0x1404511d0: movzx eax, byte ptr [rdi + 0xf]
0x1404511d4: mov byte ptr [rdx + rcx], al
0x1404511d7: jmp 0x140451228
0x1404511d9: movzx r8d, word ptr [rdi + 0x4e]
0x1404511de: mov ecx, dword ptr [rbx + 0x28]
0x1404511e1: mov edx, r8d
0x1404511e4: mov rax, qword ptr [rbx + 0x10]
0x1404511e8: shr edx, 8
0x1404511eb: mov byte ptr [rcx + rax], dl
0x1404511ee: mov ecx, dword ptr [rbx + 0x28]
0x1404511f1: mov rax, qword ptr [rbx + 0x10]
0x1404511f5: inc ecx
0x1404511f7: mov dword ptr [rbx + 0x28], ecx
0x1404511fa: mov byte ptr [rcx + rax], r8b
0x1404511fe: mov edx, dword ptr [rbx + 0x28]
0x140451201: mov rax, qword ptr [rbx + 0x10]
0x140451205: inc edx
0x140451207: mov dword ptr [rbx + 0x28], edx
0x14045120a: movzx r8d, word ptr [rdi + 0x4c]
0x14045120f: mov ecx, r8d
0x140451212: shr ecx, 8
0x140451215: mov byte ptr [rdx + rax], cl
0x140451218: mov ecx, dword ptr [rbx + 0x28]
0x14045121b: mov rax, qword ptr [rbx + 0x10]
0x14045121f: inc ecx
0x140451221: mov dword ptr [rbx + 0x28], ecx
0x140451224: mov byte ptr [rcx + rax], r8b
0x140451228: inc dword ptr [rbx + 0x28]
0x14045122b: mov rcx, rdi
0x14045122e: call 0x1404512a0
0x140451233: mov eax, dword ptr [rbx + 0x2c]
0x140451236: test eax, eax
0x140451238: jle 0x14045123f
0x14045123a: neg eax
0x14045123c: mov dword ptr [rbx + 0x2c], eax
0x14045123f: cmp dword ptr [rbx + 0x28], esi
0x140451242: sete sil
0x140451246: mov eax, esi
0x140451248: jmp 0x140451128
0x14045124d: cmp dword ptr [rdi + 0x18], esi
0x140451250: jne 0x140451259
0x140451252: mov dword ptr [rbx + 0x40], 0xffffffff
0x140451259: xor eax, eax
0x14045125b: jmp 0x140451128
0x140451260: lea rax, [rip + 0x3c3701]   ; "buffer error"
0x140451267: mov qword ptr [rdi + 0x20], rax
0x14045126b: mov eax, 0xfffffffb
0x140451270: jmp 0x140451128
0x140451275: lea rax, [rip + 0x3c370c]   ; "stream error"
0x14045127c: mov qword ptr [rcx + 0x20], rax
0x140451280: mov eax, 0xfffffffe
0x140451285: add rsp, 0x20
0x140451289: pop r14
0x14045128b: pop rdi
0x14045128c: pop rbx
0x14045128d: ret 
0x14045128e: int3 
0x14045128f: int3 
0x140451290: int3 
0x140451291: int3 
0x140451292: int3 
0x140451293: int3 
0x140451294: int3 
0x140451295: int3 
0x140451296: int3 
0x140451297: int3 
0x140451298: int3 
0x140451299: int3 
0x14045129a: int3 
0x14045129b: int3 
0x14045129c: int3 
0x14045129d: int3 
0x14045129e: int3 
0x14045129f: int3 
