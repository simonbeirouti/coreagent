import { useState, useEffect } from "react"
import { GalleryVerticalEnd } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import supabase from "@/lib/supabase"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [step, setStep] = useState<"email" | "otp">("email")
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [otp, setOtp] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    firstName?: string
    lastName?: string
    email?: string
  }>({})
  const [resendDisabled, setResendDisabled] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)

  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000)
      return () => clearTimeout(timer)
    } else {
      setResendDisabled(false)
    }
  }, [resendCountdown])

  // Validation functions
  const validateFirstName = (value: string): string | undefined => {
    if (!value.trim()) return "First name is required"
    if (value.trim().length < 2) return "First name must be at least 2 characters"
    if (!/^[a-zA-Z\s-']+$/.test(value.trim())) return "First name can only contain letters, spaces, hyphens, and apostrophes"
    return undefined
  }

  const validateLastName = (value: string): string | undefined => {
    if (!value.trim()) return "Last name is required"
    if (value.trim().length < 2) return "Last name must be at least 2 characters"
    if (!/^[a-zA-Z\s-']+$/.test(value.trim())) return "Last name can only contain letters, spaces, hyphens, and apostrophes"
    return undefined
  }

  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) return "Email is required"
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (!emailRegex.test(value.trim())) return "Please enter a valid email address"
    return undefined
  }

  const validateForm = (): boolean => {
    const errors = {
      firstName: validateFirstName(firstName),
      lastName: validateLastName(lastName),
      email: validateEmail(email),
    }

    setFieldErrors(errors)
    return !Object.values(errors).some(error => error !== undefined)
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!validateForm()) {
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          },
        },
      })

      if (error) throw error

      setStep("otp")
      setResendDisabled(true)
      setResendCountdown(60)
    } catch (err: any) {
      setError(err.message || "Failed to send verification code")
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.length !== 6) return

    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      })

      if (error) throw error

      // Auth context will handle session sync
    } catch (err: any) {
      setError(err.message || "Invalid verification code")
      setOtp("")
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    setError(null)
    setFieldErrors({})

    if (!validateForm()) {
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          },
        },
      })

      if (error) throw error

      setResendDisabled(true)
      setResendCountdown(60)
      setOtp("")
    } catch (err: any) {
      setError(err.message || "Failed to resend code")
    } finally {
      setLoading(false)
    }
  }

  const handleChangeEmail = () => {
    setStep("email")
    setOtp("")
    setError(null)
    setFieldErrors({})
    // Keep the name fields filled in case they want to resend
  }

  if (step === "otp") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <form onSubmit={handleVerifyOtp}>
          <FieldGroup>
            <div className="flex flex-col items-center gap-2 text-center">
              <a
                href="#"
                className="flex flex-col items-center gap-2 font-medium"
              >
                <div className="flex size-8 items-center justify-center rounded-md">
                  <GalleryVerticalEnd className="size-6" />
                </div>
                <span className="sr-only">CoreAgent</span>
              </a>
              <h1 className="text-xl font-bold">Enter verification code</h1>
              <FieldDescription>
                We sent a 6-digit code to {email}
              </FieldDescription>
            </div>

            {error && (
              <div className="text-sm text-red-500 text-center">{error}</div>
            )}

            <Field>
              <FieldLabel htmlFor="otp" className="sr-only">
                Verification code
              </FieldLabel>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  id="otp"
                  value={otp}
                  onChange={setOtp}
                  disabled={loading}
                  containerClassName="gap-4"
                >
                  <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:h-16 *:data-[slot=input-otp-slot]:w-12 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border *:data-[slot=input-otp-slot]:text-xl">
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:h-16 *:data-[slot=input-otp-slot]:w-12 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border *:data-[slot=input-otp-slot]:text-xl">
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <FieldDescription className="text-center">
                Didn&apos;t receive the code?{" "}
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendDisabled || loading}
                  className="font-medium hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resendDisabled ? `Resend (${resendCountdown}s)` : "Resend"}
                </button>
              </FieldDescription>
            </Field>
            <Field>
              <Button type="submit" disabled={loading || otp.length !== 6}>
                {loading ? "Verifying..." : "Verify"}
              </Button>
            </Field>
            <Field>
              <Button
                type="button"
                variant="outline"
                onClick={handleChangeEmail}
                disabled={loading}
              >
                Change Email
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={handleSendOtp}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <a
              href="#"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <div className="flex size-8 items-center justify-center rounded-md">
                <GalleryVerticalEnd className="size-6" />
              </div>
              <span className="sr-only">CoreAgent</span>
            </a>
            <h1 className="text-xl font-bold">Welcome to CoreAgent</h1>
            <FieldDescription>
              Enter your email to receive a verification code
            </FieldDescription>
          </div>

          {error && (
            <div className="text-sm text-red-500 text-center">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="firstName">First Name</FieldLabel>
              <Input
                id="firstName"
                type="text"
                placeholder="John"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value)
                  if (fieldErrors.firstName) {
                    setFieldErrors(prev => ({ ...prev, firstName: undefined }))
                  }
                }}
                disabled={loading}
                required
              />
              {fieldErrors.firstName && (
                <p className="text-sm text-red-500 mt-1">{fieldErrors.firstName}</p>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="lastName">Last Name</FieldLabel>
              <Input
                id="lastName"
                type="text"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value)
                  if (fieldErrors.lastName) {
                    setFieldErrors(prev => ({ ...prev, lastName: undefined }))
                  }
                }}
                disabled={loading}
                required
              />
              {fieldErrors.lastName && (
                <p className="text-sm text-red-500 mt-1">{fieldErrors.lastName}</p>
              )}
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="john.doe@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (fieldErrors.email) {
                  setFieldErrors(prev => ({ ...prev, email: undefined }))
                }
              }}
              disabled={loading}
              required
            />
            {fieldErrors.email && (
              <p className="text-sm text-red-500 mt-1">{fieldErrors.email}</p>
            )}
          </Field>
          <Field>
            <Button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Continue"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  )
}
